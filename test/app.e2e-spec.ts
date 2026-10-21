import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AppModule } from '../src/app.module.js';
import { checkHeartbeat, HEARTBEAT_FILE } from '../src/monitoring/index.js';
import { CycleService, POLL_JOB } from '../src/scheduler/index.js';

const NUXT_FEED = 'https://nuxt.com/blog/rss.xml';
const NEST_FEED = 'https://github.com/nestjs/nest/releases.atom';
const NUXT_HOOK = 'https://discord.com/api/webhooks/1/nuxt-token';
const NEST_HOOK = 'https://discord.com/api/webhooks/2/nest-token';

const fixture = (name: string): string =>
  readFileSync(`test/fixtures/${name}`, 'utf8');

/** The Nuxt fixture with one more, newer article at the top. */
const nuxtWithNewPost = (): string =>
  fixture('nuxt-rss.xml').replace(
    '<item>',
    `<item>
      <title><![CDATA[Nuxt 4.7]]></title>
      <link>https://nuxt.com/blog/v4-7</link>
      <guid isPermaLink="true">https://nuxt.com/blog/v4-7</guid>
      <pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate>
      <description><![CDATA[Nuxt 4.7 is out. @everyone [click](https://evil.example)]]></description>
    </item>
    <item>`,
  );

/**
 * The whole app, with only the network faked: feeds answer from the
 * fixtures, Discord accepts every post and we record them.
 */
describe('feedhook (e2e)', () => {
  let dataDir: string;
  let app: INestApplicationContext;
  let nuxtBody: string;
  let posts: { webhook: string; payload: Record<string, unknown> }[];

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'feedhook-e2e-'));
    vi.stubEnv('DATA_DIR', dataDir);
    vi.stubEnv('FEEDS_FILE', 'feeds.yaml');
    vi.stubEnv('DISCORD_WEBHOOK_NUXT', NUXT_HOOK);
    vi.stubEnv('DISCORD_WEBHOOK_NESTJS', NEST_HOOK);

    nuxtBody = fixture('nuxt-rss.xml');
    posts = [];
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.href === NUXT_FEED) return new Response(nuxtBody);
        if (url.href === NEST_FEED)
          return new Response(fixture('nestjs-releases.atom'));
        if (url.hostname === 'discord.com') {
          posts.push({
            webhook: `${url.origin}${url.pathname}`,
            payload: JSON.parse(String(init?.body)) as Record<string, unknown>,
          });
          return new Response(JSON.stringify({ id: '1' }), { status: 200 });
        }
        throw new Error(`unexpected request to ${url.href}`);
      },
    );

    app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    await app.init();
    // The startup cycle runs in the background: wait for it.
    await app.get(CycleService).idle();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('writes a heartbeat after the startup cycle, found healthy by the healthcheck', async () => {
    const path = join(dataDir, HEARTBEAT_FILE);
    // Monitoring runs just after the cycle: give it a moment.
    for (let i = 0; i < 50 && !existsSync(path); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const result = checkHeartbeat(readFileSync(path, 'utf8'), Date.now());
    expect(result).toEqual({ healthy: true, reason: 'last cycle 0 min ago' });
  });

  it('schedules the hourly poll', () => {
    const job = app.get(SchedulerRegistry).getCronJob(POLL_JOB);

    expect(job.cronTime.source).toBe('0 * * * *');
    expect(job.isActive).toBe(true);
  });

  it('posts nothing on the first run, then each new article once to its own channel', async () => {
    // First run (at startup): existing articles recorded, nothing posted.
    expect(posts).toEqual([]);

    nuxtBody = nuxtWithNewPost();
    const report = await app.get(CycleService).run();

    expect(report.ok).toBe(true);
    expect(posts).toHaveLength(1);
    const [{ webhook, payload }] = posts;
    expect(webhook).toBe(NUXT_HOOK);
    expect(payload).toMatchObject({
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: 'Nuxt 4.7',
          url: 'https://nuxt.com/blog/v4-7',
          author: { name: 'Nuxt Blog' },
          color: 0x00dc82,
          timestamp: '2026-10-20T10:00:00.000Z',
        },
      ],
    });
    const [embed] = payload.embeds as { description: string }[];
    expect(embed.description).toContain(
      '\\[click\\]\\(https://evil.example\\)',
    );

    // Next cycle: the same feed again, nothing new.
    await app.get(CycleService).run();
    expect(posts).toHaveLength(1);
  });

  it('on shutdown, lets the running post finish before closing the database', async () => {
    nuxtBody = nuxtWithNewPost();
    // Discord takes a while to answer this time.
    let answerDiscord: () => void = () => undefined;
    const discordAnswered = new Promise<void>((resolve) => {
      answerDiscord = resolve;
    });
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (new URL(String(input)).hostname === 'discord.com')
          await discordAnswered;
        return realFetch(input, init);
      },
    );

    const cycle = app.get(CycleService).run();
    const closing = app.close();
    answerDiscord();

    // The cycle ends normally (no "database is not open"), and the item
    // was marked as seen before the database closed.
    await expect(cycle).resolves.toMatchObject({ ok: true });
    await closing;
    expect(posts).toHaveLength(1);

    app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    await app.init();
    await app.get(CycleService).idle();
    expect(posts).toHaveLength(1);
  });

  it('remembers what was posted across a restart', async () => {
    nuxtBody = nuxtWithNewPost();
    await app.get(CycleService).run();
    await app.close();

    app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    await app.init();
    await app.get(CycleService).idle();

    expect(posts).toHaveLength(1);
  });
});
