import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_NAME, APP_VERSION, REPO_URL } from '../app-info.js';
import { FetchError } from './fetch.error.js';
import {
  type CacheValidators,
  FETCH_FN,
  FETCHER_OPTIONS,
  type FetchFn,
  type FetcherOptions,
  type FetchResult,
} from './fetcher.types.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = `${APP_NAME}/${APP_VERSION} (+${REPO_URL})`;
const ACCEPT =
  'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.1';

/**
 * Downloads a feed safely and cheaply:
 * - https only, including every redirect hop (redirects are followed by hand);
 * - one timeout for the whole operation, body download included, so a server
 *   that sends bytes very slowly cannot block a cycle;
 * - a maximum body size, checked while streaming, not after;
 * - conditional requests (ETag / Last-Modified) so an unchanged feed costs a
 *   `304 Not Modified` with no body.
 */
@Injectable()
export class FetcherService {
  private readonly logger = new Logger(FetcherService.name);

  constructor(
    @Inject(FETCHER_OPTIONS) private readonly options: FetcherOptions,
    @Inject(FETCH_FN) private readonly fetchFn: FetchFn,
  ) {}

  async fetch(
    url: string,
    validators: CacheValidators = {},
  ): Promise<FetchResult> {
    const started = performance.now();
    const signal = AbortSignal.timeout(this.options.timeoutMs);

    try {
      const response = await this.request(url, validators, signal);

      if (response.status === 304) {
        await response.body?.cancel();
        this.logger.debug(`${url} -> 304 not modified (${elapsed(started)})`);
        return { status: 'not-modified' };
      }

      const body = await this.readBody(response, url, signal);
      this.logger.debug(
        `${url} -> ${response.status}, ${Buffer.byteLength(body)} bytes (${elapsed(started)})`,
      );
      return {
        status: 'ok',
        body,
        validators: {
          etag: response.headers.get('etag') ?? undefined,
          lastModified: response.headers.get('last-modified') ?? undefined,
        },
      };
    } catch (error) {
      if (error instanceof FetchError) throw error;
      if (signal.aborted) {
        throw new FetchError(
          'timeout',
          url,
          `no complete answer within ${this.options.timeoutMs} ms`,
          undefined,
          { cause: error },
        );
      }
      throw new FetchError(
        'network',
        url,
        `request failed: ${describe(error)}`,
        undefined,
        {
          cause: error,
        },
      );
    }
  }

  /** Sends the request and follows redirects, refusing any non-https hop. */
  private async request(
    url: string,
    validators: CacheValidators,
    signal: AbortSignal,
  ): Promise<Response> {
    let current = requireHttps(url, url);

    for (let hop = 0; hop <= this.options.maxRedirects; hop++) {
      const response = await this.fetchFn(current, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: buildHeaders(validators),
      });

      if (!REDIRECT_STATUSES.has(response.status)) {
        if (response.ok || response.status === 304) return response;
        await response.body?.cancel();
        throw new FetchError(
          'http-status',
          url,
          `server answered HTTP ${response.status}`,
          response.status,
        );
      }

      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) {
        throw new FetchError(
          'http-status',
          url,
          `redirect (HTTP ${response.status}) without a Location header`,
          response.status,
        );
      }
      // Location may be relative: resolve it against the current URL.
      current = requireHttps(new URL(location, current).href, url);
    }

    throw new FetchError(
      'too-many-redirects',
      url,
      `more than ${this.options.maxRedirects} redirects`,
    );
  }

  /** Reads the body as UTF-8 text, stopping as soon as it gets too large. */
  private async readBody(
    response: Response,
    url: string,
    signal: AbortSignal,
  ): Promise<string> {
    const { maxBytes } = this.options;
    const tooLarge = (): FetchError =>
      new FetchError('too-large', url, `feed is larger than ${maxBytes} bytes`);

    // Cheap early check when the server announces the size.
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel();
      throw tooLarge();
    }
    if (!response.body) return '';

    const reader = response.body.getReader();
    // Stop waiting for bytes as soon as the timeout fires.
    const onAbort = (): void => void reader.cancel(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw tooLarge();
        }
        chunks.push(value);
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    // A cancelled read ends like a normal one: make sure we did not just
    // receive a truncated body because of the timeout.
    signal.throwIfAborted();

    return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
  }
}

function requireHttps(candidate: string, original: string): string {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new FetchError(
      'insecure-url',
      original,
      `invalid URL "${candidate}"`,
    );
  }
  if (parsed.protocol !== 'https:') {
    throw new FetchError(
      'insecure-url',
      original,
      `refusing non-https URL "${parsed.href}"`,
    );
  }
  return parsed.href;
}

function buildHeaders(validators: CacheValidators): Record<string, string> {
  const headers: Record<string, string> = {
    'user-agent': USER_AGENT,
    accept: ACCEPT,
  };
  if (validators.etag) headers['if-none-match'] = validators.etag;
  if (validators.lastModified)
    headers['if-modified-since'] = validators.lastModified;
  return headers;
}

function elapsed(started: number): string {
  return `${Math.round(performance.now() - started)} ms`;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    // Node's fetch wraps the real reason (ENOTFOUND, ECONNREFUSED...) in `cause`.
    const cause = error.cause as
      { code?: string; message?: string } | undefined;
    return cause?.code ?? cause?.message ?? error.message;
  }
  return String(error);
}
