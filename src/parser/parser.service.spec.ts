import { readFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { ParseError } from './parse.error.js';
import { ParserModule } from './parser.module.js';
import { ParserService } from './parser.service.js';

const fixture = (name: string): string =>
  readFileSync(`test/fixtures/${name}`, 'utf8');
const FEED_URL = 'https://example.com/feed.xml';

/** A minimal RSS document around the given <item> elements. */
const rss = (items: string): string =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title>${items}</channel></rss>`;

describe('ParserService', () => {
  const parser = new ParserService();

  describe('Nuxt blog (RSS 2.0)', () => {
    const feed = parser.parse(
      fixture('nuxt-rss.xml'),
      'https://nuxt.com/blog/rss.xml',
    );

    it('reads the feed title and every item', () => {
      expect(feed.title).toBe('The Nuxt Blog');
      expect(feed.items).toHaveLength(3);
      expect(feed.skipped).toBe(0);
    });

    it('maps an item', () => {
      expect(feed.items[0]).toEqual({
        id: 'https://nuxt.com/blog/v4-6',
        title: 'Nuxt 4.6',
        link: 'https://nuxt.com/blog/v4-6',
        date: new Date('2026-10-05T23:00:00Z'),
        summary: expect.stringMatching(/^Nuxt 4\.6 makes Nuxt server-agnostic/),
        image: 'https://nuxt.com/assets/blog/v4.6.png',
      });
    });
  });

  describe('NestJS releases (Atom)', () => {
    const feed = parser.parse(
      fixture('nestjs-releases.atom'),
      'https://github.com/nestjs/nest/releases.atom',
    );

    it('reads every release', () => {
      expect(feed.items.map((item) => item.title)).toEqual([
        'v12.2.0',
        'v12.1.3',
        'v12.1.2',
      ]);
    });

    it('maps a release, using the update date and plain-text notes', () => {
      const [release] = feed.items;

      expect(release.id).toBe(
        'tag:github.com,2008:Repository/80945428/v12.2.0',
      );
      expect(release.link).toBe(
        'https://github.com/nestjs/nest/releases/tag/v12.2.0',
      );
      expect(release.date).toEqual(new Date('2026-10-19T10:50:46Z'));
      expect(release.summary).toMatch(
        /^v12\.2\.0 \(2026-10-19\)\n\nNotable changes\n\n/,
      );
      expect(release.summary).toContain('\n• ValidationPipe takes');
      expect(release.summary).not.toMatch(/<[a-z]/i);
      expect(release.summary!.length).toBeLessThanOrEqual(2000);
    });
  });

  describe('untrusted content', () => {
    it('drops javascript: links and images, keeping the item by its guid', () => {
      const { items } = parser.parse(
        rss(`<item><guid>id-1</guid><title>Hi</title><link>javascript:alert(1)</link>
             <enclosure url="data:image/png;base64,AAAA" type="image/png" length="1"/></item>`),
        FEED_URL,
      );

      expect(items).toEqual([{ id: 'id-1', title: 'Hi' }]);
    });

    it('resolves relative links against the feed URL', () => {
      const { items } = parser.parse(
        rss('<item><title>Rel</title><link>/posts/1</link></item>'),
        FEED_URL,
      );

      expect(items[0]).toMatchObject({
        id: 'https://example.com/posts/1',
        link: 'https://example.com/posts/1',
      });
    });

    it('strips HTML from titles', () => {
      const { items } = parser.parse(
        rss(
          '<item><guid>1</guid><title>&lt;b&gt;Bold&lt;/b&gt; &amp; &lt;script&gt;x&lt;/script&gt;new</title></item>',
        ),
        FEED_URL,
      );

      expect(items[0].title).toBe('Bold & new');
    });

    it('does not expand DTD entities (billion laughs)', () => {
      const xml = `<?xml version="1.0"?>
        <!DOCTYPE rss [<!ENTITY a "AAAAAAAAAA"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>
        <rss version="2.0"><channel><title>t</title><item><guid>1</guid><title>&b;</title></item></channel></rss>`;

      const { items } = parser.parse(xml, FEED_URL);

      expect(items[0].title.length).toBeLessThan(20);
    });

    it('bounds titles and summaries', () => {
      const { items } = parser.parse(
        rss(
          `<item><guid>1</guid><title>${'t '.repeat(1000)}</title><description>${'d '.repeat(5000)}</description></item>`,
        ),
        FEED_URL,
      );

      expect(items[0].title.length).toBeLessThanOrEqual(512);
      expect(items[0].summary!.length).toBeLessThanOrEqual(2000);
    });

    it('hashes very long ids', () => {
      const { items } = parser.parse(
        rss(`<item><guid>${'x'.repeat(2000)}</guid><title>Long</title></item>`),
        FEED_URL,
      );

      expect(items[0].id).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it('keeps at most 100 items', () => {
      const many = Array.from(
        { length: 150 },
        (_, i) => `<item><guid>${i}</guid><title>${i}</title></item>`,
      ).join('');

      expect(parser.parse(rss(many), FEED_URL).items).toHaveLength(100);
    });
  });

  describe('missing data', () => {
    it('skips items with neither an id nor a link', () => {
      const feed = parser.parse(
        rss(
          '<item><title>No id</title></item><item><guid>ok</guid><title>Ok</title></item>',
        ),
        FEED_URL,
      );

      expect(feed.items.map((item) => item.id)).toEqual(['ok']);
      expect(feed.skipped).toBe(1);
    });

    it('skips a duplicated id inside the same document', () => {
      const feed = parser.parse(
        rss(
          '<item><guid>a</guid><title>1</title></item><item><guid>a</guid><title>2</title></item>',
        ),
        FEED_URL,
      );

      expect(feed.items.map((item) => item.title)).toEqual(['1']);
      expect(feed.skipped).toBe(1);
    });

    it('falls back to the link for a missing title, and omits a bad date', () => {
      const { items } = parser.parse(
        rss(
          '<item><link>https://a.com/x</link><pubDate>not a date</pubDate></item>',
        ),
        FEED_URL,
      );

      expect(items[0].title).toBe('https://a.com/x');
      expect(items[0]).not.toHaveProperty('date');
    });

    it('returns no items for an empty channel', () => {
      expect(parser.parse(rss(''), FEED_URL).items).toEqual([]);
    });
  });

  describe('invalid documents', () => {
    it.each([
      ['an HTML page', '<html><body>Not found</body></html>'],
      ['garbage', 'not xml <<'],
      ['an empty body', ''],
    ])('throws a ParseError for %s', (_, xml) => {
      expect(() => parser.parse(xml, FEED_URL)).toThrow(ParseError);
    });

    it('names the feed in the error', () => {
      expect(() => parser.parse('<html/>', FEED_URL)).toThrow(FEED_URL);
    });
  });

  it('is provided by ParserModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ParserModule],
    }).compile();

    expect(moduleRef.get(ParserService)).toBeInstanceOf(ParserService);
    await moduleRef.close();
  });
});
