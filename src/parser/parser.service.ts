import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { parseFeed } from '@rowanmanning/feed-parser';
import type { FeedItem, ParsedFeed } from './feed-item.js';
import { ParseError } from './parse.error.js';
import { htmlToText, safeHttpUrl, truncate } from './text.js';

type Entry = ReturnType<typeof parseFeed>['items'][number];

/** Only the newest entries matter; this bounds the work on huge feeds. */
const MAX_ITEMS = 100;
const MAX_TITLE = 512;
const MAX_SUMMARY = 2000;
/** Longer ids are hashed so the store keeps a fixed-size key. */
const MAX_ID = 512;

/**
 * Turns RSS 2.0 and Atom documents into `FeedItem`s.
 *
 * Feeds are untrusted input: only http(s) links and images are kept
 * (no `javascript:` or `data:`), HTML is reduced to plain text, and every
 * text field is bounded. Parsing itself is done by @rowanmanning/feed-parser,
 * built on fast-xml-parser, which does not expand DTD entities.
 */
@Injectable()
export class ParserService {
  /**
   * @param xml the downloaded document
   * @param feedUrl the feed's URL, used to resolve relative links
   */
  parse(xml: string, feedUrl: string): ParsedFeed {
    let feed: ReturnType<typeof parseFeed>;
    try {
      feed = parseFeed(xml);
    } catch (error) {
      throw new ParseError(
        `not a valid RSS or Atom feed (${feedUrl}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }

    const items: FeedItem[] = [];
    const seen = new Set<string>();
    let skipped = 0;

    for (const entry of feed.items.slice(0, MAX_ITEMS)) {
      const item = toFeedItem(entry, feedUrl);
      // No usable id, or the same id twice in one document: skip it.
      if (!item || seen.has(item.id)) {
        skipped++;
        continue;
      }
      seen.add(item.id);
      items.push(item);
    }

    return { title: htmlToText(feed.title ?? ''), items, skipped };
  }
}

function toFeedItem(entry: Entry, feedUrl: string): FeedItem | undefined {
  const link = safeHttpUrl(entry.url, feedUrl);
  const rawId = entry.id?.trim() || link;
  if (!rawId) return undefined;

  const title =
    truncate(htmlToText(entry.title ?? ''), MAX_TITLE) || link || '(untitled)';
  const summaryText = htmlToText(entry.description || entry.content || '');
  const date = entry.published ?? entry.updated ?? undefined;
  const image = safeHttpUrl(
    entry.mediaImages[0]?.url ?? entry.image?.url,
    feedUrl,
  );

  return Object.freeze({
    id: stableId(rawId),
    title,
    ...(link && { link }),
    ...(date && !Number.isNaN(date.getTime()) && { date }),
    ...(summaryText && { summary: truncate(summaryText, MAX_SUMMARY) }),
    ...(image && { image }),
  });
}

function stableId(rawId: string): string {
  if (rawId.length <= MAX_ID) return rawId;
  return `sha256:${createHash('sha256').update(rawId).digest('hex')}`;
}
