import type { Secret } from './secret.js';

/** One feed to watch, after validation. */
export interface FeedConfig {
  /** Stable identifier, used as the key in the store (e.g. `nuxt-blog`). */
  readonly id: string;
  /** Display name shown in Discord embeds. */
  readonly name: string;
  /** Feed URL, always https. */
  readonly url: string;
  /** Embed colour as an integer, the format Discord expects (`#00DC82` -> 56450). */
  readonly color: number;
  /** Discord webhook URL for this feed's channel. */
  readonly webhookUrl: Secret;
}

/**
 * The validated configuration of the whole app. It is built once at startup
 * by `loadAppConfig` and injected by class: `constructor(private readonly config: AppConfig)`.
 * Everything is read-only and frozen.
 */
export class AppConfig {
  constructor(
    readonly feeds: readonly FeedConfig[],
    /** Cron expression for the poll cycle (default: every hour). */
    readonly pollCron: string,
    /** Directory holding the SQLite database. */
    readonly dataDir: string,
    /** Optional Uptime Kuma push monitor URL. */
    readonly uptimeKumaPushUrl: Secret | undefined,
  ) {
    Object.freeze(this);
  }
}
