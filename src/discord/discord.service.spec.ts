import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Secret, type FeedConfig } from '../config/index.js';
import type { FetchFn } from '../fetcher/fetcher.types.js';
import type { FeedItem } from '../parser/index.js';
import { DiscordError } from './discord.error.js';
import { DiscordModule } from './discord.module.js';
import { DiscordService } from './discord.service.js';
import type { DiscordOptions } from './discord.types.js';

const TOKEN = 'very-secret-token';
const FEED: FeedConfig = {
  id: 'nuxt-blog',
  name: 'Nuxt Blog',
  url: 'https://nuxt.com/blog/rss.xml',
  color: 0x00dc82,
  webhookUrl: new Secret(`https://discord.com/api/webhooks/123/${TOKEN}`),
};
const ITEM: FeedItem = {
  id: 'a',
  title: 'Nuxt 4.6',
  link: 'https://nuxt.com/blog/v4-6',
};
const OPTIONS: DiscordOptions = {
  timeoutMs: 1000,
  maxAttempts: 4,
  backoffMs: 100,
  maxWaitMs: 60_000,
};

type Answer = Response | Error;

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const created = (headers: Record<string, string> = {}): Response =>
  json(200, { id: '1' }, headers);

/** A service whose fetch returns `answers` in order and whose sleep only records. */
function setup(answers: Answer[], options: Partial<DiscordOptions> = {}) {
  const requests: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init: init ?? {} });
    const answer = answers.shift();
    if (!answer) throw new Error('unexpected request');
    if (answer instanceof Error) throw answer;
    return answer;
  }) as FetchFn;
  const sleep = async (ms: number): Promise<void> => {
    sleeps.push(ms);
  };
  const service = new DiscordService(
    { ...OPTIONS, ...options },
    fetchFn,
    sleep,
  );
  return { service, requests, sleeps };
}

async function expectDiscordError(
  promise: Promise<unknown>,
): Promise<DiscordError> {
  const error = await promise.then(
    () => {
      throw new Error('expected a DiscordError');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DiscordError);
  // The webhook token must never appear in an error.
  expect(String((error as Error).message)).not.toContain(TOKEN);
  return error as DiscordError;
}

describe('DiscordService', () => {
  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  describe('success', () => {
    it('posts the embed as JSON and waits for Discord to create the message', async () => {
      const { service, requests } = setup([created()]);

      await service.post(FEED, ITEM);

      expect(requests).toHaveLength(1);
      const [{ url, init }] = requests;
      expect(url).toBe(
        `https://discord.com/api/webhooks/123/${TOKEN}?wait=true`,
      );
      expect(init.method).toBe('POST');
      expect(init.redirect).toBe('error');
      expect((init.headers as Record<string, string>)['content-type']).toBe(
        'application/json',
      );
      const body = JSON.parse(String(init.body));
      expect(body.allowed_mentions).toEqual({ parse: [] });
      expect(body.embeds[0]).toMatchObject({
        title: 'Nuxt 4.6',
        author: { name: 'Nuxt Blog' },
      });
    });

    it('keeps existing query parameters of the webhook (e.g. thread_id)', async () => {
      const { service, requests } = setup([created()]);
      const feed = {
        ...FEED,
        webhookUrl: new Secret(`${FEED.webhookUrl.reveal()}?thread_id=9`),
      };

      await service.post(feed, ITEM);

      expect(new URL(requests[0].url).searchParams.get('thread_id')).toBe('9');
      expect(new URL(requests[0].url).searchParams.get('wait')).toBe('true');
    });

    it('accepts 204 No Content', async () => {
      const { service } = setup([new Response(null, { status: 204 })]);

      await expect(service.post(FEED, ITEM)).resolves.toBeUndefined();
    });
  });

  describe('rate limits', () => {
    it('waits the retry_after Discord asks for on a 429, then retries', async () => {
      const { service, requests, sleeps } = setup([
        json(429, {
          message: 'You are being rate limited.',
          retry_after: 1.5,
          global: false,
        }),
        created(),
      ]);

      await service.post(FEED, ITEM);

      expect(requests).toHaveLength(2);
      expect(sleeps).toEqual([1500]);
    });

    it('falls back to the Retry-After header', async () => {
      const { service, sleeps } = setup([
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '3' },
        }),
        created(),
      ]);

      await service.post(FEED, ITEM);

      expect(sleeps).toEqual([3000]);
    });

    it('fails instead of waiting longer than maxWaitMs', async () => {
      const { service, requests } = setup([json(429, { retry_after: 600 })]);

      const error = await expectDiscordError(service.post(FEED, ITEM));

      expect(error.status).toBe(429);
      expect(requests).toHaveLength(1);
    });

    it('waits before the next post when the bucket is empty', async () => {
      const { service, sleeps } = setup([
        created({
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset-after': '2',
        }),
        created(),
      ]);

      await service.post(FEED, ITEM);
      await service.post(FEED, ITEM);

      expect(sleeps).toHaveLength(1);
      expect(sleeps[0]).toBeGreaterThan(1900);
      expect(sleeps[0]).toBeLessThanOrEqual(2000);
    });

    it('does not wait while the bucket has requests left', async () => {
      const { service, sleeps } = setup([
        created({
          'x-ratelimit-remaining': '4',
          'x-ratelimit-reset-after': '2',
        }),
        created(),
      ]);

      await service.post(FEED, ITEM);
      await service.post(FEED, ITEM);

      expect(sleeps).toEqual([]);
    });
  });

  describe('retries', () => {
    it('retries 5xx errors with exponential backoff', async () => {
      const { service, requests, sleeps } = setup([
        new Response('oops', { status: 502 }),
        new Response('oops', { status: 503 }),
        created(),
      ]);

      await service.post(FEED, ITEM);

      expect(requests).toHaveLength(3);
      expect(sleeps).toEqual([100, 200]);
    });

    it('retries network errors', async () => {
      const { service, requests } = setup([
        new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }),
        created(),
      ]);

      await service.post(FEED, ITEM);

      expect(requests).toHaveLength(2);
    });

    it('gives up after maxAttempts, with the last reason', async () => {
      const { service, requests } = setup(
        Array.from({ length: 4 }, () => new Response('oops', { status: 500 })),
      );

      const error = await expectDiscordError(service.post(FEED, ITEM));

      expect(requests).toHaveLength(4);
      expect(error.status).toBe(500);
      expect(error.message).toContain('nuxt-blog');
    });

    it('gives up after maxAttempts on network errors', async () => {
      const failure = new TypeError('fetch failed', {
        cause: { code: 'ENOTFOUND' },
      });
      const { service } = setup([failure, failure], { maxAttempts: 2 });

      const error = await expectDiscordError(service.post(FEED, ITEM));

      expect(error.message).toContain('ENOTFOUND');
    });
  });

  describe('errors that retrying cannot fix', () => {
    it.each([
      [404, { message: 'Unknown Webhook', code: 10015 }, /webhook not found/],
      [
        401,
        { message: 'Invalid Webhook Token', code: 50027 },
        /token rejected/,
      ],
      [
        400,
        { message: 'Invalid Form Body', code: 50035 },
        /HTTP 400: Invalid Form Body \(code 50035\)/,
      ],
    ])('fails at once on HTTP %i', async (status, body, message) => {
      const { service, requests } = setup([json(status, body)]);

      const error = await expectDiscordError(service.post(FEED, ITEM));

      expect(requests).toHaveLength(1);
      expect(error.status).toBe(status);
      expect(error.message).toMatch(message);
    });

    it('copes with a non-JSON error body', async () => {
      const { service } = setup([
        new Response('<html>Bad Request</html>', { status: 400 }),
      ]);

      const error = await expectDiscordError(service.post(FEED, ITEM));

      expect(error.message).toContain('HTTP 400');
    });
  });

  it('never logs the webhook token', async () => {
    const lines: string[] = [];
    const capture = (message: unknown): void => {
      lines.push(String(message));
    };
    Logger.overrideLogger({
      log: capture,
      warn: capture,
      error: capture,
      debug: capture,
      verbose: capture,
    });
    try {
      const { service } = setup([
        json(429, { retry_after: 0.1 }),
        new Response('oops', { status: 500 }),
        created(),
      ]);
      await service.post(FEED, ITEM);
    } finally {
      Logger.overrideLogger(false);
    }

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain(TOKEN);
  });

  it('is provided by DiscordModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscordModule],
    }).compile();

    expect(moduleRef.get(DiscordService)).toBeInstanceOf(DiscordService);
    await moduleRef.close();
  });
});
