import { decode } from 'html-entities';

/** Tags whose content is never readable text. */
const DROP_WITH_CONTENT =
  /<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
/** End of a block (paragraph, heading...): a blank line. */
const BLOCK_ENDS = /<\/(?:p|div|h[1-6]|blockquote|pre|table)\s*>/gi;
/**
 * Line break. Lists end with a single one, so nested lists (a category
 * with its own bullets, common in release notes) stay compact.
 */
const LINE_BREAKS = /<(?:br|hr|\/tr|\/ul|\/ol)\b[^>]*>/gi;
/** Each list item on its own line, with a bullet. */
const LIST_ITEM = /<li\b[^>]*>/gi;
const ANY_TAG = /<\/?[a-z!?][^>]*>/gi;

/**
 * Turns HTML (or text with entities) into plain text.
 *
 * The result is only ever displayed as text (in a Discord embed), never
 * rendered as HTML, so removing the tags is enough: there is no HTML
 * sanitising to get right. Markdown escaping is Discord's job (issue #6).
 */
export function htmlToText(html: string): string {
  const text = html
    // In HTML, line breaks in the source are just spaces: only tags make lines.
    .replace(/\s+/g, ' ')
    .replace(DROP_WITH_CONTENT, '')
    .replace(LIST_ITEM, '\n• ')
    .replace(BLOCK_ENDS, '\n\n')
    .replace(LINE_BREAKS, '\n')
    .replace(ANY_TAG, '');

  return (
    decode(text)
      // Non-breaking and zero-width spaces, tabs -> plain spaces
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/[​-‍﻿]/g, '')
      .replace(/ *\n */g, '\n')
      .replace(/ {2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      // No blank line between two bullets (e.g. after a nested list).
      .replace(/(?<=^• [^\n]*)\n{2,}(?=• )/gm, '\n')
      .trim()
  );
}

/** Cuts `text` to `max` characters, on a word boundary when possible. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Absolute http(s) URL, resolved against `base` when relative; else undefined. */
export function safeHttpUrl(
  value: string | null | undefined,
  base?: string,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim(), base);
    // Refuses javascript:, data:, file: and friends.
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
