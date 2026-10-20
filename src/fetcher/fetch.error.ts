export type FetchErrorKind =
  | 'insecure-url'
  | 'timeout'
  | 'too-large'
  | 'too-many-redirects'
  | 'http-status'
  | 'network';

/**
 * A feed could not be downloaded. `kind` lets the scheduler decide what to
 * log; the message is safe to log (feed URLs are public, never secrets).
 */
export class FetchError extends Error {
  override readonly name = 'FetchError';

  constructor(
    readonly kind: FetchErrorKind,
    readonly url: string,
    message: string,
    /** HTTP status, for `http-status` errors. */
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(`${message} (${url})`, options);
  }
}
