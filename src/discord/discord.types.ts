export interface DiscordOptions {
  /** Per HTTP request. */
  readonly timeoutMs: number;
  /** Total attempts for one post (first try + retries). */
  readonly maxAttempts: number;
  /** First retry delay after a 5xx or network error; doubles each time. */
  readonly backoffMs: number;
  /** Never wait longer than this for a rate limit; fail instead. */
  readonly maxWaitMs: number;
}

export const DEFAULT_DISCORD_OPTIONS: DiscordOptions = Object.freeze({
  timeoutMs: 10_000,
  maxAttempts: 4,
  backoffMs: 1_000,
  maxWaitMs: 60_000,
});

export const DISCORD_OPTIONS = Symbol('DISCORD_OPTIONS');
/** Injectable so tests do not really wait. */
export const SLEEP_FN = Symbol('SLEEP_FN');
export type SleepFn = (ms: number) => Promise<void>;

export const sleep: SleepFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));
