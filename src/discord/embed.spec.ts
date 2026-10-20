import { Secret, type FeedConfig } from '../config/index.js';
import type { FeedItem } from '../parser/index.js';
import { buildPayload, DISCORD_LIMITS, escapeMarkdown } from './embed.js';

const FEED: FeedConfig = {
  id: 'nuxt-blog',
  name: 'Nuxt Blog',
  url: 'https://nuxt.com/blog/rss.xml',
  color: 0x00dc82,
  webhookUrl: new Secret('https://discord.com/api/webhooks/1/token'),
};

const ITEM: FeedItem = {
  id: 'https://nuxt.com/blog/v4-6',
  title: 'Nuxt 4.6',
  link: 'https://nuxt.com/blog/v4-6',
  date: new Date('2026-10-05T23:00:00Z'),
  summary: 'Nuxt 4.6 makes Nuxt server-agnostic.',
  image: 'https://nuxt.com/assets/blog/v4.6.png',
};

describe('buildPayload', () => {
  it('builds one embed with the item and the feed colour', () => {
    expect(buildPayload(FEED, ITEM)).toEqual({
      embeds: [
        {
          title: 'Nuxt 4.6',
          url: 'https://nuxt.com/blog/v4-6',
          description: 'Nuxt 4.6 makes Nuxt server\\-agnostic.',
          color: 0x00dc82,
          timestamp: '2026-10-05T23:00:00.000Z',
          author: { name: 'Nuxt Blog' },
          thumbnail: { url: 'https://nuxt.com/assets/blog/v4.6.png' },
        },
      ],
      allowed_mentions: { parse: [] },
    });
  });

  it('always disables mentions, even if the feed writes @everyone', () => {
    const payload = buildPayload(FEED, {
      ...ITEM,
      title: '@everyone',
      summary: '<@&123> @here',
    });

    expect(payload.allowed_mentions).toEqual({ parse: [] });
  });

  it('omits the optional fields the item does not have', () => {
    const [embed] = buildPayload(FEED, {
      id: 'x',
      title: 'Only a title',
    }).embeds;

    expect(Object.keys(embed).sort()).toEqual(['author', 'color', 'title']);
  });

  it('keeps every field within Discord limits', () => {
    const [embed] = buildPayload(
      { ...FEED, name: 'n'.repeat(500) },
      { ...ITEM, title: 't'.repeat(1000), summary: '*_'.repeat(5000) },
    ).embeds;

    expect(embed.title.length).toBeLessThanOrEqual(DISCORD_LIMITS.title);
    expect(embed.author.name.length).toBeLessThanOrEqual(
      DISCORD_LIMITS.authorName,
    );
    expect(embed.description!.length).toBeLessThanOrEqual(
      DISCORD_LIMITS.description,
    );
    const total =
      embed.title.length + embed.author.name.length + embed.description!.length;
    expect(total).toBeLessThanOrEqual(DISCORD_LIMITS.total);
  });

  it('shortens long summaries to a readable notification', () => {
    const [embed] = buildPayload(FEED, {
      ...ITEM,
      summary: 'word '.repeat(1000),
    }).embeds;

    expect(embed.description!.length).toBeLessThanOrEqual(1500);
    expect(embed.description).toMatch(/…$/);
  });
});

describe('escapeMarkdown', () => {
  it('neutralises masked links, so the real URL stays visible', () => {
    expect(escapeMarkdown('[Get the fix](https://evil.example)')).toBe(
      '\\[Get the fix\\]\\(https://evil.example\\)',
    );
  });

  it('escapes formatting characters', () => {
    expect(
      escapeMarkdown(
        '**bold** _it_ ~~del~~ `code` ||spoiler|| # title > quote',
      ),
    ).toBe(
      '\\*\\*bold\\*\\* \\_it\\_ \\~\\~del\\~\\~ \\`code\\` \\|\\|spoiler\\|\\| \\# title \\> quote',
    );
  });

  it('escapes backslashes first, so an escape cannot be undone', () => {
    expect(escapeMarkdown('\\*')).toBe('\\\\\\*');
  });

  it('leaves plain text and bullets alone', () => {
    expect(escapeMarkdown('• Fix: v12.1.3 is out.')).toBe(
      '• Fix: v12.1.3 is out.',
    );
  });
});
