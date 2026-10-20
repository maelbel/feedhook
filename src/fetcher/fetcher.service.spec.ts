import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FetchError } from './fetch.error.js';
import { FetcherModule } from './fetcher.module.js';
import { FetcherService } from './fetcher.service.js';
import { type FetchFn, type FetcherOptions } from './fetcher.types.js';

const URL_OK = 'https://example.com/feed.xml';
const OPTIONS: FetcherOptions = {
  timeoutMs: 200,
  maxBytes: 1024,
  maxRedirects: 2,
};

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** A fake `fetch` that records each call and answers with `handler`. */
function fakeFetch(handler: Handler) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      headers: { ...(init?.headers as Record<string, string>) },
    });
    return handler(url, init ?? {});
  });
  return { fn: fn as unknown as FetchFn, calls };
}

function service(handler: Handler, options: Partial<FetcherOptions> = {}) {
  const fake = fakeFetch(handler);
  return {
    fetcher: new FetcherService({ ...OPTIONS, ...options }, fake.fn),
    calls: fake.calls,
  };
}

/** Expects a FetchError of the given kind and returns it. */
async function expectFetchError(
  promise: Promise<unknown>,
  kind: FetchError['kind'],
) {
  const error = await promise.then(
    () => {
      throw new Error('expected a FetchError');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(FetchError);
  expect((error as FetchError).kind).toBe(kind);
  return error as FetchError;
}

/** A body that sends `chunks`, one every `delayMs`. */
function slowStream(
  chunks: string[],
  delayMs: number,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
      else controller.close();
    },
  });
}

describe('FetcherService', () => {
  beforeAll(() => {
    // Keep the test output readable: the service logs every fetch.
    Logger.overrideLogger(false);
  });

  describe('successful fetch', () => {
    it('returns the body and the cache validators', async () => {
      const { fetcher } = service(
        () =>
          new Response('<rss>é</rss>', {
            status: 200,
            headers: {
              etag: '"v1"',
              'last-modified': 'Mon, 19 Oct 2026 10:00:00 GMT',
            },
          }),
      );

      await expect(fetcher.fetch(URL_OK)).resolves.toEqual({
        status: 'ok',
        body: '<rss>é</rss>',
        validators: {
          etag: '"v1"',
          lastModified: 'Mon, 19 Oct 2026 10:00:00 GMT',
        },
      });
    });

    it('sends a User-Agent and an Accept header for feeds', async () => {
      const { fetcher, calls } = service(() => new Response('ok'));

      await fetcher.fetch(URL_OK);

      expect(calls[0].headers['user-agent']).toMatch(
        /^feedhook\/\d+\.\d+\.\d+ \(\+https:\/\//,
      );
      expect(calls[0].headers.accept).toContain('application/rss+xml');
    });

    it('sends conditional headers and handles 304 Not Modified', async () => {
      const { fetcher, calls } = service(
        () => new Response(null, { status: 304 }),
      );

      const result = await fetcher.fetch(URL_OK, {
        etag: '"v1"',
        lastModified: 'Mon, 19 Oct 2026 10:00:00 GMT',
      });

      expect(result).toEqual({ status: 'not-modified' });
      expect(calls[0].headers['if-none-match']).toBe('"v1"');
      expect(calls[0].headers['if-modified-since']).toBe(
        'Mon, 19 Oct 2026 10:00:00 GMT',
      );
    });

    it('sends no conditional headers on a first fetch', async () => {
      const { fetcher, calls } = service(() => new Response('ok'));

      await fetcher.fetch(URL_OK);

      expect(calls[0].headers).not.toHaveProperty('if-none-match');
      expect(calls[0].headers).not.toHaveProperty('if-modified-since');
    });
  });

  describe('redirects', () => {
    it('follows https redirects, including relative ones', async () => {
      const { fetcher, calls } = service((url) => {
        if (url === URL_OK) {
          return new Response(null, {
            status: 301,
            headers: { location: 'https://cdn.example.com/a.xml' },
          });
        }
        if (url === 'https://cdn.example.com/a.xml') {
          return new Response(null, {
            status: 302,
            headers: { location: '/b.xml' },
          });
        }
        return new Response('final');
      });

      const result = await fetcher.fetch(URL_OK);

      expect(result).toMatchObject({ status: 'ok', body: 'final' });
      expect(calls.map((call) => call.url)).toEqual([
        URL_OK,
        'https://cdn.example.com/a.xml',
        'https://cdn.example.com/b.xml',
      ]);
    });

    it('refuses a redirect to http, without following it', async () => {
      const { fetcher, calls } = service(
        () =>
          new Response(null, {
            status: 302,
            headers: { location: 'http://example.com/feed' },
          }),
      );

      await expectFetchError(fetcher.fetch(URL_OK), 'insecure-url');
      expect(calls).toHaveLength(1);
    });

    it('stops after too many redirects', async () => {
      const { fetcher } = service(
        () =>
          new Response(null, { status: 307, headers: { location: '/loop' } }),
      );

      await expectFetchError(fetcher.fetch(URL_OK), 'too-many-redirects');
    });

    it('reports a redirect without Location', async () => {
      const { fetcher } = service(() => new Response(null, { status: 301 }));

      await expectFetchError(fetcher.fetch(URL_OK), 'http-status');
    });
  });

  describe('failures', () => {
    it('refuses a non-https feed URL without sending any request', async () => {
      const { fetcher, calls } = service(() => new Response('ok'));

      await expectFetchError(
        fetcher.fetch('http://example.com/feed.xml'),
        'insecure-url',
      );
      expect(calls).toHaveLength(0);
    });

    it.each([404, 410, 500, 503])(
      'reports HTTP %i with its status',
      async (status) => {
        const { fetcher } = service(
          () => new Response('error page', { status }),
        );

        const error = await expectFetchError(
          fetcher.fetch(URL_OK),
          'http-status',
        );
        expect(error.status).toBe(status);
        expect(error.message).toContain(URL_OK);
      },
    );

    it('reports network errors with their cause', async () => {
      const { fetcher } = service(() => {
        throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
      });

      const error = await expectFetchError(fetcher.fetch(URL_OK), 'network');
      expect(error.message).toContain('ENOTFOUND');
    });

    it('times out when the server does not answer', async () => {
      const { fetcher } = service(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(init.signal?.reason),
            );
          }),
        { timeoutMs: 30 },
      );

      await expectFetchError(fetcher.fetch(URL_OK), 'timeout');
    });

    it('times out when the body arrives too slowly', async () => {
      const { fetcher } = service(
        () => new Response(slowStream(['<rss>', '<item/>', '</rss>'], 25)),
        { timeoutMs: 40 },
      );

      await expectFetchError(fetcher.fetch(URL_OK), 'timeout');
    });
  });

  describe('size limit', () => {
    it('refuses a body announced as too large without reading it', async () => {
      const { fetcher } = service(
        () =>
          new Response('small', { headers: { 'content-length': '999999' } }),
      );

      await expectFetchError(fetcher.fetch(URL_OK), 'too-large');
    });

    it('stops reading a streamed body once it is too large', async () => {
      const chunk = 'x'.repeat(400);
      const { fetcher } = service(
        () => new Response(slowStream([chunk, chunk, chunk, chunk], 1)),
      );

      await expectFetchError(fetcher.fetch(URL_OK), 'too-large');
    });

    it('accepts a body exactly at the limit', async () => {
      const { fetcher } = service(
        () => new Response('x'.repeat(OPTIONS.maxBytes)),
      );

      await expect(fetcher.fetch(URL_OK)).resolves.toMatchObject({
        status: 'ok',
      });
    });
  });

  it('is provided by FetcherModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FetcherModule],
    }).compile();

    expect(moduleRef.get(FetcherService)).toBeInstanceOf(FetcherService);
    await moduleRef.close();
  });
});
