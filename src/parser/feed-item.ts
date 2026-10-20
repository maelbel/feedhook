/**
 * One entry of a feed, in the same shape for RSS and Atom. This is what the
 * rest of the app works with: the store remembers `id`, Discord shows the rest.
 */
export interface FeedItem {
  /** Stable identifier: RSS `guid` / Atom `id`, else the link. */
  readonly id: string;
  /** Plain text, never empty. */
  readonly title: string;
  /** Absolute http(s) URL of the article, when the feed provides a valid one. */
  readonly link?: string;
  /** Publication date, else last update date. */
  readonly date?: Date;
  /** Plain-text summary (HTML stripped), bounded in length. */
  readonly summary?: string;
  /** Absolute http(s) URL of an illustration. */
  readonly image?: string;
}

export interface ParsedFeed {
  /** Feed title, plain text (may be empty). */
  readonly title: string;
  readonly items: readonly FeedItem[];
  /** Entries dropped because they had neither an id nor a usable link. */
  readonly skipped: number;
}
