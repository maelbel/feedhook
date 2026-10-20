/**
 * HTTP cache validators remembered between two fetches of the same feed.
 * Sending them back lets the server answer `304 Not Modified` with no body
 * when nothing changed, which saves bandwidth on both sides.
 */
export interface CacheValidators {
  readonly etag?: string;
  readonly lastModified?: string;
}

export type FetchResult =
  | {
      readonly status: 'not-modified';
    }
  | {
      readonly status: 'ok';
      readonly body: string;
      /** Validators to store for the next fetch. */
      readonly validators: CacheValidators;
    };

export interface FetcherOptions {
  /** Whole request, redirects included. */
  readonly timeoutMs: number;
  /** Larger bodies are refused, to protect the Pi's memory. */
  readonly maxBytes: number;
  readonly maxRedirects: number;
}

export const DEFAULT_FETCHER_OPTIONS: FetcherOptions = Object.freeze({
  timeoutMs: 10_000,
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 5,
});

/** Injection tokens, so tests can swap the options and the fetch function. */
export const FETCHER_OPTIONS = Symbol('FETCHER_OPTIONS');
export const FETCH_FN = Symbol('FETCH_FN');
export type FetchFn = typeof globalThis.fetch;
