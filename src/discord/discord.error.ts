/**
 * Discord did not accept a post, after the retries that made sense.
 * The message names the feed but never contains the webhook URL (a secret).
 */
export class DiscordError extends Error {
  override readonly name = 'DiscordError';

  constructor(
    readonly feedId: string,
    message: string,
    /** HTTP status of the last answer, if there was one. */
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(`Discord post for feed "${feedId}" failed: ${message}`, options);
  }
}
