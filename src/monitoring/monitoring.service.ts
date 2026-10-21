import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_NAME, APP_VERSION, REPO_URL } from '../app-info.js';
import { AppConfig } from '../config/index.js';
import { FETCH_FN, type FetchFn } from '../fetcher/fetcher.types.js';
import type { CycleReport } from '../scheduler/cycle.types.js';
import { type Heartbeat, HEARTBEAT_FILE, maxAgeFor } from './heartbeat.js';

const USER_AGENT = `${APP_NAME}/${APP_VERSION} (+${REPO_URL})`;
const PUSH_TIMEOUT_MS = 10_000;
/** Uptime Kuma shows the message in notifications: keep it short. */
const MAX_MESSAGE = 200;

/**
 * Tells the outside world that feedhook is alive, after every cycle:
 * - writes the heartbeat file read by the Docker healthcheck;
 * - pings the Uptime Kuma push monitor, if `UPTIME_KUMA_PUSH_URL` is set:
 *   `up` when every feed went fine, `down` with the failing feeds otherwise,
 *   and the cycle duration as the "ping".
 *
 * Monitoring must never break the app: every failure here is logged and
 * swallowed. The push URL contains a token: it is revealed only to build
 * the request and never logged.
 */
@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    private readonly config: AppConfig,
    @Inject(FETCH_FN) private readonly fetchFn: FetchFn,
  ) {}

  async afterCycle(report: CycleReport, pollIntervalMs: number): Promise<void> {
    this.writeHeartbeat(report, pollIntervalMs);
    await this.push(report);
  }

  private writeHeartbeat(report: CycleReport, pollIntervalMs: number): void {
    const heartbeat: Heartbeat = {
      lastCycleAt: new Date().toISOString(),
      maxAgeMs: maxAgeFor(pollIntervalMs),
      ok: report.ok,
    };
    const path = join(this.config.dataDir, HEARTBEAT_FILE);
    try {
      // Write then rename: the healthcheck never reads a half-written file.
      writeFileSync(`${path}.tmp`, JSON.stringify(heartbeat), { mode: 0o600 });
      renameSync(`${path}.tmp`, path);
    } catch (error) {
      this.logger.warn(
        `could not write the heartbeat file: ${describe(error)}`,
      );
    }
  }

  private async push(report: CycleReport): Promise<void> {
    const pushUrl = this.config.uptimeKumaPushUrl;
    if (!pushUrl) return;

    const url = new URL(pushUrl.reveal());
    url.searchParams.set('status', report.ok ? 'up' : 'down');
    url.searchParams.set('msg', summarize(report));
    url.searchParams.set('ping', String(report.durationMs));

    try {
      const response = await this.fetchFn(url, {
        method: 'GET',
        headers: { 'user-agent': USER_AGENT },
        redirect: 'error',
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      });
      await response.body?.cancel();
      if (!response.ok) {
        this.logger.warn(`Uptime Kuma push refused: HTTP ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(`Uptime Kuma push failed: ${describe(error)}`);
    }
  }
}

/** `OK: nuxt-blog posted 1, nestjs-releases not-modified` or the failures. */
export function summarize(report: CycleReport): string {
  const failed = report.feeds.filter((feed) => feed.status === 'failed');
  const text = report.ok
    ? `OK: ${report.feeds.map(describeFeed).join(', ') || 'no feed'}`
    : `${failed.length} feed(s) failed: ${failed
        .map((feed) => `${feed.feedId} (${feed.error ?? 'unknown error'})`)
        .join('; ')}`;
  return text.length > MAX_MESSAGE
    ? `${text.slice(0, MAX_MESSAGE - 1)}…`
    : text;
}

function describeFeed(feed: CycleReport['feeds'][number]): string {
  return feed.status === 'posted'
    ? `${feed.feedId} posted ${feed.posted}`
    : `${feed.feedId} ${feed.status}`;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return 'timeout';
    const cause = error.cause as { code?: string } | undefined;
    return cause?.code ?? error.message;
  }
  return String(error);
}
