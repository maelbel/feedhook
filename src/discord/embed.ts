import type { FeedConfig } from '../config/index.js';
import type { FeedItem } from '../parser/index.js';
import { truncate } from '../parser/text.js';

/** Discord limits: https://discord.com/developers/docs/resources/message#embed-object-embed-limits */
export const DISCORD_LIMITS = Object.freeze({
  title: 256,
  description: 4096,
  authorName: 256,
  /** All text of all embeds of one message. */
  total: 6000,
});

/** Shorter than Discord's limit: a notification, not the whole article. */
const DESCRIPTION_LENGTH = 1500;

export interface DiscordEmbed {
  title: string;
  url?: string;
  description?: string;
  color: number;
  timestamp?: string;
  author: { name: string };
  thumbnail?: { url: string };
}

export interface WebhookPayload {
  embeds: DiscordEmbed[];
  /** Never ping anyone, whatever the feed contains (@everyone, roles, users). */
  allowed_mentions: { parse: [] };
}

/**
 * Escapes Discord markdown in feed text. Without it, a feed could write a
 * masked link like `[Download the fix](https://evil.example)`, which shows
 * only "Download the fix" in the channel. Escaped, the URL stays visible.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\*_~`|[\]()<>#-]/g, '\\$&');
}

/** Builds the webhook message for one item of one feed. */
export function buildPayload(feed: FeedConfig, item: FeedItem): WebhookPayload {
  const embed: DiscordEmbed = {
    title: truncate(item.title, DISCORD_LIMITS.title),
    color: feed.color,
    author: { name: truncate(feed.name, DISCORD_LIMITS.authorName) },
  };
  if (item.link) embed.url = item.link;
  if (item.summary) {
    // Escaping adds characters: cut first, escape, then make sure we still fit.
    embed.description = truncate(
      escapeMarkdown(truncate(item.summary, DESCRIPTION_LENGTH)),
      DISCORD_LIMITS.description,
    );
  }
  if (item.date) embed.timestamp = item.date.toISOString();
  if (item.image) embed.thumbnail = { url: item.image };

  return { embeds: [embed], allowed_mentions: { parse: [] } };
}
