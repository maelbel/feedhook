import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppConfig, Secret } from '../config/index.js';
import type { FetchFn } from '../fetcher/fetcher.types.js';
import type { CycleReport } from '../scheduler/cycle.types.js';
import { checkHeartbeat, HEARTBEAT_FILE } from './heartbeat.js';
import { MonitoringModule } from './monitoring.module.js';
import { MonitoringService, summarize } from './monitoring.service.js';

const TOKEN = 'kuma-push-token';
const PUSH_URL = `https://kuma.example.com/api/push/${TOKEN}?status=up&msg=OK&ping=`;
const HOUR = 60 * 60_000;

const OK_REPORT: CycleReport = {
  startedAt: new Date(),
  durationMs: 640,
  ok: true,
  feeds: [
    { feedId: 'nuxt-blog', status: 'posted', posted: 1, pending: 0 },
    {
      feedId: 'nestjs-releases',
      status: 'not-modified',
      posted: 0,
      pending: 0,
    },
  ],
};
const FAILED_REPORT: CycleReport = {
  ...OK_REPORT,
  ok: false,
  feeds: [
    {
      feedId: 'nuxt-blog',
      status: 'failed',
      posted: 0,
      pending: 0,
      error: 'request failed: ENOTFOUND (https://nuxt.com/blog/rss.xml)',
    },
    { feedId: 'nestjs-releases', status: 'up-to-date', posted: 0, pending: 0 },
  ],
};

describe('MonitoringService', () => {
  let dataDir: string;
  let requests: URL[];
  let answer: () => Response;
  let logs: string[];

  const serviceWith = (pushUrl?: string): MonitoringService => {
    const config = new AppConfig(
      [],
      '0 * * * *',
      dataDir,
      pushUrl ? new Secret(pushUrl) : undefined,
    );
    const fetchFn = (async (input: RequestInfo | URL) => {
      requests.push(new URL(String(input)));
      return answer();
    }) as FetchFn;
    return new MonitoringService(config, fetchFn);
  };

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'feedhook-monitoring-'));
    requests = [];
    answer = () => new Response('{"ok":true}');
    logs = [];
    const capture = (message: unknown): void => {
      logs.push(String(message));
    };
    Logger.overrideLogger({
      log: capture,
      warn: capture,
      error: capture,
      debug: capture,
      verbose: capture,
    });
  });

  afterEach(() => {
    Logger.overrideLogger(false);
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe('heartbeat file', () => {
    it('is written after each cycle and read as healthy by the healthcheck', async () => {
      await serviceWith().afterCycle(OK_REPORT, HOUR);

      const path = join(dataDir, HEARTBEAT_FILE);
      const content = readFileSync(path, 'utf8');
      expect(JSON.parse(content)).toMatchObject({
        maxAgeMs: 125 * 60_000,
        ok: true,
      });
      expect(checkHeartbeat(content, Date.now()).healthy).toBe(true);
      expect(statSync(path).mode & 0o777).toBe(0o600);
    });

    it('does not throw when the file cannot be written', async () => {
      const service = serviceWith();
      rmSync(dataDir, { recursive: true, force: true });

      await expect(
        service.afterCycle(OK_REPORT, HOUR),
      ).resolves.toBeUndefined();
      expect(logs.join('\n')).toContain('could not write the heartbeat file');
    });
  });

  describe('Uptime Kuma push', () => {
    it('sends nothing when no push URL is configured', async () => {
      await serviceWith().afterCycle(OK_REPORT, HOUR);

      expect(requests).toEqual([]);
    });

    it('pushes "up" with a summary and the cycle duration', async () => {
      await serviceWith(PUSH_URL).afterCycle(OK_REPORT, HOUR);

      expect(requests).toHaveLength(1);
      const [url] = requests;
      expect(url.pathname).toBe(`/api/push/${TOKEN}`);
      expect(url.searchParams.get('status')).toBe('up');
      expect(url.searchParams.get('msg')).toBe(
        'OK: nuxt-blog posted 1, nestjs-releases not-modified',
      );
      expect(url.searchParams.get('ping')).toBe('640');
    });

    it('pushes "down" naming the failing feeds', async () => {
      await serviceWith(PUSH_URL).afterCycle(FAILED_REPORT, HOUR);

      const [url] = requests;
      expect(url.searchParams.get('status')).toBe('down');
      expect(url.searchParams.get('msg')).toBe(
        '1 feed(s) failed: nuxt-blog (request failed: ENOTFOUND (https://nuxt.com/blog/rss.xml))',
      );
    });

    it.each([
      [
        'an HTTP error',
        () =>
          new Response('{"ok":false,"msg":"Monitor not found"}', {
            status: 404,
          }),
      ],
      [
        'a network error',
        () => {
          throw new TypeError('fetch failed', {
            cause: { code: 'ECONNREFUSED' },
          });
        },
      ],
    ])('never throws on %s, and never logs the token', async (_, failing) => {
      answer = failing;

      await expect(
        serviceWith(PUSH_URL).afterCycle(OK_REPORT, HOUR),
      ).resolves.toBeUndefined();

      expect(logs.join('\n')).toMatch(/Uptime Kuma push (refused|failed)/);
      expect(logs.join('\n')).not.toContain(TOKEN);
    });
  });

  it('keeps the push message short', () => {
    const many: CycleReport = {
      ...FAILED_REPORT,
      feeds: Array.from({ length: 20 }, (_, i) => ({
        feedId: `feed-${i}`,
        status: 'failed' as const,
        posted: 0,
        pending: 0,
        error: 'request failed: timeout',
      })),
    };

    expect(summarize(many).length).toBeLessThanOrEqual(200);
  });

  it('is provided by MonitoringModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MonitoringModule],
    })
      .useMocker((token) =>
        token === AppConfig
          ? new AppConfig([], '0 * * * *', dataDir, undefined)
          : undefined,
      )
      .compile();

    expect(moduleRef.get(MonitoringService)).toBeInstanceOf(MonitoringService);
    await moduleRef.close();
  });
});
