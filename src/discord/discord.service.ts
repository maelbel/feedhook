import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_NAME, APP_VERSION, REPO_URL } from '../app-info.js';
import type { FeedConfig } from '../config/index.js';
import { FETCH_FN, type FetchFn } from '../fetcher/fetcher.types.js';
import type { FeedItem } from '../parser/index.js';
import { DiscordError } from './discord.error.js';
import {
  DISCORD_OPTIONS,
  type DiscordOptions,
  SLEEP_FN,
  type SleepFn,
} from './discord.types.js';
import { buildPayload } from './embed.js';

const USER_AGENT = `${APP_NAME}/${APP_VERSION} (+${REPO_URL})`;
/** Discord's error answers are short; never read more than this. */
const MAX_ERROR_BODY = 2000;

interface DiscordErrorBody {
  message?: string;
  code?: number;
  retry_after?: number;
}

/**
 * Posts feed items to Discord webhooks.
 *
 * - `?wait=true`: Discord answers only once the message really exists, so
 *   "success" means posted, and the scheduler can then mark the item as seen.
 * - 429 (rate limited): waits the time Discord asks for, then retries.
 * - 5xx / network errors: retries with exponential backoff.
 * - Other 4xx (bad payload, deleted webhook): fails at once, retrying
 *   would not help.
 * - Rate-limit headers are respected before the next post to the same
 *   webhook, so we rarely hit a 429 at all.
 *
 * The webhook URL (a secret) is revealed only to build the request and is
 * never part of a log line or an error message.
 */
@Injectable()
export class DiscordService {
  private readonly logger = new Logger(DiscordService.name);
  /** Per webhook, in memory only: earliest time for the next request. */
  private readonly notBefore = new Map<string, number>();

  constructor(
    @Inject(DISCORD_OPTIONS) private readonly options: DiscordOptions,
    @Inject(FETCH_FN) private readonly fetchFn: FetchFn,
    @Inject(SLEEP_FN) private readonly sleep: SleepFn,
  ) {}

  /** Resolves once Discord has created the message; throws `DiscordError` otherwise. */
  async post(feed: FeedConfig, item: FeedItem): Promise<void> {
    const webhook = feed.webhookUrl.reveal();
    const url = new URL(webhook);
    url.searchParams.set('wait', 'true');
    const body = JSON.stringify(buildPayload(feed, item));
    const { maxAttempts } = this.options;

    for (let attempt = 1; ; attempt++) {
      const isLast = attempt >= maxAttempts;
      await this.waitForRateLimit(webhook);

      let response: Response;
      try {
        response = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': USER_AGENT,
          },
          body,
          // A webhook never redirects: refusing protects the token.
          redirect: 'error',
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });
      } catch (error) {
        const failure = new DiscordError(
          feed.id,
          `network error (${describe(error)})`,
          undefined,
          { cause: error },
        );
        if (isLast) throw failure;
        await this.retryLater(feed, attempt, failure.message);
        continue;
      }

      this.rememberRateLimit(webhook, response.headers);

      if (response.ok) {
        await response.body?.cancel();
        this.logger.debug(`posted "${item.title}" for feed ${feed.id}`);
        return;
      }

      const detail = await readErrorBody(response);

      if (response.status === 429) {
        const waitMs = retryAfterMs(detail, response.headers);
        if (isLast || waitMs > this.options.maxWaitMs) {
          throw new DiscordError(
            feed.id,
            `rate limited by Discord (retry after ${Math.ceil(waitMs / 1000)} s)`,
            429,
          );
        }
        this.logger.warn(
          `feed ${feed.id}: rate limited, waiting ${waitMs} ms (attempt ${attempt}/${maxAttempts})`,
        );
        await this.sleep(waitMs);
        continue;
      }

      if (response.status >= 500) {
        const message = `Discord answered HTTP ${response.status}`;
        if (isLast) throw new DiscordError(feed.id, message, response.status);
        await this.retryLater(feed, attempt, message);
        continue;
      }

      throw new DiscordError(
        feed.id,
        explain(response.status, detail),
        response.status,
      );
    }
  }

  private async retryLater(
    feed: FeedConfig,
    attempt: number,
    reason: string,
  ): Promise<void> {
    const delay = this.options.backoffMs * 2 ** (attempt - 1);
    this.logger.warn(
      `feed ${feed.id}: ${reason}, retrying in ${delay} ms (attempt ${attempt}/${this.options.maxAttempts})`,
    );
    await this.sleep(delay);
  }

  private async waitForRateLimit(webhook: string): Promise<void> {
    const wait = (this.notBefore.get(webhook) ?? 0) - Date.now();
    if (wait > 0) await this.sleep(Math.min(wait, this.options.maxWaitMs));
  }

  /** Discord tells us when a webhook's bucket is empty; wait before the next post. */
  private rememberRateLimit(webhook: string, headers: Headers): void {
    const remaining = headers.get('x-ratelimit-remaining');
    const resetAfter = Number(headers.get('x-ratelimit-reset-after'));
    if (remaining === '0' && Number.isFinite(resetAfter) && resetAfter > 0) {
      this.notBefore.set(webhook, Date.now() + Math.ceil(resetAfter * 1000));
    } else {
      this.notBefore.delete(webhook);
    }
  }
}

async function readErrorBody(response: Response): Promise<DiscordErrorBody> {
  try {
    const text = (await response.text()).slice(0, MAX_ERROR_BODY);
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as DiscordErrorBody)
      : {};
  } catch {
    return {};
  }
}

/** Seconds from the JSON body (precise), else the Retry-After header, else 1 s. */
function retryAfterMs(detail: DiscordErrorBody, headers: Headers): number {
  const seconds =
    typeof detail.retry_after === 'number'
      ? detail.retry_after
      : Number(headers.get('retry-after') ?? 1);
  return Math.ceil(
    (Number.isFinite(seconds) && seconds > 0 ? seconds : 1) * 1000,
  );
}

function explain(status: number, detail: DiscordErrorBody): string {
  if (status === 404)
    return 'webhook not found (deleted, or wrong URL in the env var)';
  if (status === 401 || status === 403) return 'webhook token rejected';
  const reason = detail.message
    ? `: ${String(detail.message).slice(0, 200)}`
    : '';
  const code = detail.code ? ` (code ${detail.code})` : '';
  return `Discord refused the message, HTTP ${status}${reason}${code}`;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return 'timeout';
    const cause = error.cause as { code?: string } | undefined;
    return cause?.code ?? error.message;
  }
  return String(error);
}
