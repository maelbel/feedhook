import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { AppConfig, type FeedConfig, Secret } from '../config/index.js';
import { DiscordError, type DiscordService } from '../discord/index.js';
import {
  FetchError,
  type FetcherService,
  type FetchResult,
} from '../fetcher/index.js';
import { type FeedItem, ParserService } from '../parser/index.js';
import { StoreService } from '../store/index.js';
import { CycleService } from './cycle.service.js';

const feedConfig = (id: string): FeedConfig => ({
  id,
  name: id,
  url: `https://${id}.example.com/feed.xml`,
  color: 0,
  webhookUrl: new Secret(`https://discord.com/api/webhooks/1/${id}`),
});
const NUXT = feedConfig('nuxt');
const NEST = feedConfig('nest');

/** An RSS document; items are given newest first, like real feeds. */
function rss(items: { id: string; date?: string }[]): string {
  const body = items
    .map(
      ({ id, date }) =>
        `<item><guid>${id}</guid><title>Post ${id}</title>${date ? `<pubDate>${date}</pubDate>` : ''}</item>`,
    )
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${body}</channel></rss>`;
}
const day = (n: number): string => new Date(Date.UTC(2026, 9, n)).toUTCString();
const ok = (xml: string, etag = '"v1"'): FetchResult => ({
  status: 'ok',
  body: xml,
  validators: { etag },
});

describe('CycleService', () => {
  let dataDir: string;
  let store: StoreService;
  /** What each feed URL answers next. */
  let answers: Map<string, FetchResult | Error>;
  let fetchCalls: { url: string; etag?: string }[];
  let posts: { feedId: string; title: string }[];
  /** Makes Discord fail on the post with this title. */
  let failOn: string | undefined;

  const cycleFor = (feeds: FeedConfig[], maxPostsPerFeed = 5): CycleService => {
    const config = new AppConfig(feeds, '0 * * * *', dataDir, undefined);
    const fetcher = {
      fetch: async (url: string, validators: { etag?: string }) => {
        fetchCalls.push({ url, etag: validators.etag });
        const answer = answers.get(url);
        if (!answer) throw new Error(`no answer for ${url}`);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    } as unknown as FetcherService;
    const discord = {
      post: async (feed: FeedConfig, item: FeedItem) => {
        if (item.title === failOn) {
          throw new DiscordError(feed.id, 'Discord answered HTTP 503', 503);
        }
        posts.push({ feedId: feed.id, title: item.title });
      },
    } as unknown as DiscordService;
    return new CycleService(
      config,
      fetcher,
      new ParserService(),
      store,
      discord,
      {
        maxPostsPerFeed,
      },
    );
  };

  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'feedhook-cycle-'));
    store = new StoreService(
      new AppConfig([], '0 * * * *', dataDir, undefined),
    );
    store.open();
    answers = new Map();
    fetchCalls = [];
    posts = [];
    failOn = undefined;
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe('first run', () => {
    it('records the existing items silently and saves the validators', async () => {
      answers.set(NUXT.url, ok(rss([{ id: 'b' }, { id: 'a' }])));

      const report = await cycleFor([NUXT]).run();

      expect(report.feeds).toEqual([
        { feedId: 'nuxt', status: 'seeded', posted: 0, pending: 0 },
      ]);
      expect(posts).toEqual([]);
      expect(store.unseenIds('nuxt', ['a', 'b'])).toEqual([]);
      expect(store.getValidators('nuxt')).toEqual({ etag: '"v1"' });
    });
  });

  describe('later runs', () => {
    beforeEach(() => {
      store.seed('nuxt', ['a']);
    });

    it('posts the new items oldest first and marks them as seen', async () => {
      answers.set(
        NUXT.url,
        ok(
          rss([
            { id: 'c', date: day(3) },
            { id: 'b', date: day(2) },
            { id: 'a', date: day(1) },
          ]),
          '"v2"',
        ),
      );

      const report = await cycleFor([NUXT]).run();

      expect(posts.map((post) => post.title)).toEqual(['Post b', 'Post c']);
      expect(report.feeds[0]).toEqual({
        feedId: 'nuxt',
        status: 'posted',
        posted: 2,
        pending: 0,
      });
      expect(store.unseenIds('nuxt', ['b', 'c'])).toEqual([]);
      expect(store.getValidators('nuxt')).toEqual({ etag: '"v2"' });
    });

    it('sends the stored validators and does nothing on 304', async () => {
      store.saveValidators('nuxt', { etag: '"v1"' });
      answers.set(NUXT.url, { status: 'not-modified' });

      const report = await cycleFor([NUXT]).run();

      expect(fetchCalls[0].etag).toBe('"v1"');
      expect(report.feeds[0].status).toBe('not-modified');
      expect(posts).toEqual([]);
    });

    it('reports up-to-date when the feed changed but has nothing new', async () => {
      answers.set(NUXT.url, ok(rss([{ id: 'a' }])));

      const report = await cycleFor([NUXT]).run();

      expect(report.feeds[0].status).toBe('up-to-date');
    });

    it('sorts by date, whatever the order in the feed', async () => {
      answers.set(
        NUXT.url,
        ok(
          rss([
            { id: 'x', date: day(5) },
            { id: 'y', date: day(9) },
            { id: 'z', date: day(7) },
          ]),
        ),
      );

      await cycleFor([NUXT]).run();

      expect(posts.map((post) => post.title)).toEqual([
        'Post x',
        'Post z',
        'Post y',
      ]);
    });

    it('posts undated items in reverse feed order (oldest first)', async () => {
      answers.set(
        NUXT.url,
        ok(rss([{ id: 'new' }, { id: 'mid' }, { id: 'old' }])),
      );

      await cycleFor([NUXT]).run();

      expect(posts.map((post) => post.title)).toEqual([
        'Post old',
        'Post mid',
        'Post new',
      ]);
    });
  });

  describe('cap per cycle', () => {
    it('posts at most maxPostsPerFeed and keeps the rest for the next cycle', async () => {
      store.seed('nuxt', []);
      store.saveValidators('nuxt', { etag: '"old"' });
      const items = Array.from({ length: 7 }, (_, i) => ({
        id: `i${i}`,
        date: day(i + 1),
      }));
      answers.set(NUXT.url, ok(rss([...items].reverse()), '"new"'));
      const cycle = cycleFor([NUXT], 5);

      const first = await cycle.run();

      expect(first.feeds[0]).toEqual({
        feedId: 'nuxt',
        status: 'posted',
        posted: 5,
        pending: 2,
      });
      expect(posts.map((post) => post.title)).toEqual([
        'Post i0',
        'Post i1',
        'Post i2',
        'Post i3',
        'Post i4',
      ]);
      // Not caught up: keep the old validators so the next fetch is not a 304.
      expect(store.getValidators('nuxt')).toEqual({ etag: '"old"' });

      const second = await cycle.run();

      expect(second.feeds[0]).toEqual({
        feedId: 'nuxt',
        status: 'posted',
        posted: 2,
        pending: 0,
      });
      expect(posts.map((post) => post.title).slice(5)).toEqual([
        'Post i5',
        'Post i6',
      ]);
      expect(store.getValidators('nuxt')).toEqual({ etag: '"new"' });
    });
  });

  describe('failures', () => {
    beforeEach(() => {
      store.seed('nuxt', []);
      store.seed('nest', []);
    });

    it('stops a feed at the first failed post, keeping order and the unposted items', async () => {
      store.saveValidators('nuxt', { etag: '"old"' });
      answers.set(
        NUXT.url,
        ok(
          rss([
            { id: 'c', date: day(3) },
            { id: 'b', date: day(2) },
            { id: 'a', date: day(1) },
          ]),
          '"new"',
        ),
      );
      failOn = 'Post b';
      const cycle = cycleFor([NUXT]);

      const report = await cycle.run();

      expect(report.ok).toBe(false);
      expect(report.feeds[0]).toMatchObject({
        status: 'failed',
        posted: 1,
        pending: 2,
      });
      expect(report.feeds[0].error).toContain('HTTP 503');
      expect(posts.map((post) => post.title)).toEqual(['Post a']);
      expect(store.unseenIds('nuxt', ['a', 'b', 'c'])).toEqual(['b', 'c']);
      expect(store.getValidators('nuxt')).toEqual({ etag: '"old"' });

      // Discord is back: the next cycle posts what was left, in order.
      failOn = undefined;
      await cycle.run();
      expect(posts.map((post) => post.title)).toEqual([
        'Post a',
        'Post b',
        'Post c',
      ]);
    });

    it('keeps going with the other feeds when one fails', async () => {
      answers.set(
        NUXT.url,
        new FetchError(
          'timeout',
          NUXT.url,
          'no complete answer within 10000 ms',
        ),
      );
      answers.set(NEST.url, ok(rss([{ id: 'n1' }])));

      const report = await cycleFor([NUXT, NEST]).run();

      expect(report.ok).toBe(false);
      expect(report.feeds.map((feed) => [feed.feedId, feed.status])).toEqual([
        ['nuxt', 'failed'],
        ['nest', 'posted'],
      ]);
      expect(report.feeds[0].error).toContain('no complete answer');
      expect(posts).toEqual([{ feedId: 'nest', title: 'Post n1' }]);
    });

    it('reports a document that is not a feed', async () => {
      answers.set(NUXT.url, ok('<html>Maintenance</html>'));

      const report = await cycleFor([NUXT]).run();

      expect(report.feeds[0].status).toBe('failed');
      expect(report.feeds[0].error).toContain('not a valid RSS or Atom feed');
    });
  });

  describe('lock and shutdown', () => {
    it('never runs two cycles at once', async () => {
      store.seed('nuxt', []);
      answers.set(NUXT.url, ok(rss([{ id: 'a' }])));
      const cycle = cycleFor([NUXT]);

      const [first, second] = await Promise.all([cycle.run(), cycle.run()]);

      expect(first).toBe(second);
      expect(fetchCalls).toHaveLength(1);
      expect(posts).toHaveLength(1);
      expect(cycle.isRunning).toBe(false);
    });

    it('stops after the current post when asked to', async () => {
      store.seed('nuxt', []);
      answers.set(
        NUXT.url,
        ok(
          rss([
            { id: 'b', date: day(2) },
            { id: 'a', date: day(1) },
          ]),
        ),
      );
      const cycle = cycleFor([NUXT]);
      const run = cycle.run();
      cycle.stop();

      const report = await run;

      // stop() came before the first post: nothing posted, both items kept.
      expect(posts).toEqual([]);
      expect(report.feeds[0]).toMatchObject({ posted: 0, pending: 2 });
      expect(store.unseenIds('nuxt', ['a', 'b'])).toEqual(['a', 'b']);
      await expect(cycle.idle()).resolves.toBeUndefined();
    });
  });
});
