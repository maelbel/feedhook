export type FeedStatus =
  /** Server answered 304: nothing changed since the last fetch. */
  | 'not-modified'
  /** First run for this feed: current items recorded, nothing posted. */
  | 'seeded'
  /** New items were posted. */
  | 'posted'
  /** Fetched, but nothing new. */
  | 'up-to-date'
  /** Fetch, parse or post failed; see `error`. */
  | 'failed';

export interface FeedReport {
  readonly feedId: string;
  readonly status: FeedStatus;
  /** Items posted to Discord in this cycle. */
  readonly posted: number;
  /** New items left for the next cycle (cap reached, or a post failed). */
  readonly pending: number;
  /** Safe to log: never contains a secret. */
  readonly error?: string;
}

export interface CycleReport {
  readonly startedAt: Date;
  readonly durationMs: number;
  readonly feeds: readonly FeedReport[];
  /** True when no feed failed. */
  readonly ok: boolean;
}

export interface CycleOptions {
  /** Posts per feed per cycle; the rest waits for the next cycle. */
  readonly maxPostsPerFeed: number;
}

export const DEFAULT_CYCLE_OPTIONS: CycleOptions = Object.freeze({
  maxPostsPerFeed: 5,
});

export const CYCLE_OPTIONS = Symbol('CYCLE_OPTIONS');
