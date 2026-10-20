import { inspect } from 'node:util';
import { AppConfig } from './app-config.js';
import { ConfigError } from './config.error.js';
import { loadAppConfig, type EnvReader } from './load-config.js';

const NUXT_HOOK = 'https://discord.com/api/webhooks/111/nuxt-token_A';
const NEST_HOOK = 'https://discord.com/api/webhooks/222/nest-token_B';

const VALID_YAML = `
feeds:
  - id: nuxt-blog
    name: Nuxt Blog
    url: https://nuxt.com/blog/rss.xml
    color: '#00DC82'
    webhookEnv: DISCORD_WEBHOOK_NUXT
  - id: nestjs-releases
    name: NestJS Releases
    url: https://github.com/nestjs/nest/releases.atom
    color: '#E0234E'
    webhookEnv: DISCORD_WEBHOOK_NESTJS
`;

const BASE_ENV: Record<string, string> = {
  DISCORD_WEBHOOK_NUXT: NUXT_HOOK,
  DISCORD_WEBHOOK_NESTJS: NEST_HOOK,
};

function load(
  yaml: string = VALID_YAML,
  env: Record<string, string> = BASE_ENV,
): AppConfig {
  const getEnv: EnvReader = (name) => env[name];
  return loadAppConfig(getEnv, () => yaml);
}

/** Runs `load` expecting a ConfigError and returns its issues. */
function issuesOf(yaml?: string, env?: Record<string, string>): string[] {
  try {
    load(yaml, env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return [...(error as ConfigError).issues];
  }
  throw new Error('expected a ConfigError');
}

/** One-feed YAML with a field overridden. */
function feedYaml(overrides: Record<string, string> = {}): string {
  const feed = {
    id: 'nuxt-blog',
    name: 'Nuxt Blog',
    url: 'https://nuxt.com/blog/rss.xml',
    color: "'#00DC82'",
    webhookEnv: 'DISCORD_WEBHOOK_NUXT',
    ...overrides,
  };
  const lines = Object.entries(feed).map(
    ([key, value]) => `    ${key}: ${value}`,
  );
  return `feeds:\n  - ${lines.join('\n').trimStart()}\n`;
}

describe('loadAppConfig', () => {
  describe('valid configuration', () => {
    it('builds the feeds with their webhook and colour', () => {
      const config = load();

      expect(config).toBeInstanceOf(AppConfig);
      expect(config.feeds.map((feed) => feed.id)).toEqual([
        'nuxt-blog',
        'nestjs-releases',
      ]);
      expect(config.feeds[0]).toMatchObject({
        name: 'Nuxt Blog',
        url: 'https://nuxt.com/blog/rss.xml',
        color: 0x00dc82,
      });
      expect(config.feeds[0].webhookUrl.reveal()).toBe(NUXT_HOOK);
      expect(config.feeds[1].webhookUrl.reveal()).toBe(NEST_HOOK);
    });

    it('applies defaults when optional variables are missing or empty', () => {
      const config = load(VALID_YAML, {
        ...BASE_ENV,
        POLL_CRON: '',
        DATA_DIR: '  ',
      });

      expect(config.pollCron).toBe('0 * * * *');
      expect(config.dataDir).toBe('./data');
      expect(config.uptimeKumaPushUrl).toBeUndefined();
    });

    it('reads the optional settings', () => {
      const config = load(VALID_YAML, {
        ...BASE_ENV,
        POLL_CRON: '*/30 * * * *',
        DATA_DIR: '/data',
        UPTIME_KUMA_PUSH_URL: 'https://kuma.example.com/api/push/abc',
      });

      expect(config.pollCron).toBe('*/30 * * * *');
      expect(config.dataDir).toBe('/data');
      expect(config.uptimeKumaPushUrl?.reveal()).toBe(
        'https://kuma.example.com/api/push/abc',
      );
    });

    it('accepts the other Discord webhook hosts', () => {
      const env = {
        DISCORD_WEBHOOK_NUXT:
          'https://canary.discordapp.com/api/v10/webhooks/1/t-o_k',
      };
      expect(() => load(feedYaml(), env)).not.toThrow();
    });

    it('never exposes webhook URLs when the config is logged', () => {
      const printed = inspect(load(), { depth: 10 }) + JSON.stringify(load());

      expect(printed).not.toContain('nuxt-token_A');
      expect(printed).not.toContain('nest-token_B');
    });

    it('is immutable', () => {
      const config = load();

      expect(Object.isFrozen(config)).toBe(true);
      expect(Object.isFrozen(config.feeds)).toBe(true);
      expect(Object.isFrozen(config.feeds[0])).toBe(true);
    });
  });

  describe('feeds file', () => {
    it.each([
      [
        'an http feed URL',
        { url: 'http://nuxt.com/blog/rss.xml' },
        'feeds[0].url',
      ],
      [
        'credentials in the feed URL',
        { url: 'https://user:pass@nuxt.com/rss.xml' },
        'feeds[0].url',
      ],
      ['a non-URL', { url: 'not-a-url' }, 'feeds[0].url'],
      ['an invalid id', { id: 'Nuxt Blog' }, 'feeds[0].id'],
      ['an invalid colour', { color: 'green' }, 'feeds[0].color'],
      [
        'an invalid env name',
        { webhookEnv: 'discord-webhook' },
        'feeds[0].webhookEnv',
      ],
      ['an empty name', { name: "''" }, 'feeds[0].name'],
    ])('rejects %s', (_, overrides, field) => {
      const issues = issuesOf(feedYaml(overrides));

      expect(issues.some((issue) => issue.includes(field))).toBe(true);
    });

    it('rejects unknown keys (typos)', () => {
      const issues = issuesOf(feedYaml({ webhookenv: 'X' }));

      expect(issues.join('\n')).toMatch(/feeds\[0\].*webhookenv/);
    });

    it('rejects duplicate ids', () => {
      const yaml = `${feedYaml()}${feedYaml().replace('feeds:\n', '')}`;

      expect(issuesOf(yaml)).toContainEqual(
        expect.stringContaining('feeds[1].id: duplicate id "nuxt-blog"'),
      );
    });

    it('rejects an empty feed list', () => {
      expect(issuesOf('feeds: []')).toContainEqual(
        expect.stringContaining('must contain at least one feed'),
      );
    });

    it('rejects invalid YAML', () => {
      expect(issuesOf('feeds: [unclosed')).toContainEqual(
        expect.stringContaining('invalid YAML'),
      );
    });

    it('rejects a key written twice', () => {
      expect(issuesOf('feeds: []\nfeeds: []')).toContainEqual(
        expect.stringContaining('invalid YAML'),
      );
    });

    it('reports a file that cannot be read', () => {
      const error = Object.assign(new Error('nope'), { code: 'ENOENT' });
      const read = (): string => {
        throw error;
      };

      expect(() => loadAppConfig((name) => BASE_ENV[name], read)).toThrow(
        /cannot read .*ENOENT/,
      );
    });
  });

  describe('webhooks', () => {
    it('reports a missing webhook variable by name', () => {
      const issues = issuesOf(VALID_YAML, { DISCORD_WEBHOOK_NUXT: NUXT_HOOK });

      expect(issues).toEqual([
        'feeds.yaml: feeds[1].webhookEnv: environment variable DISCORD_WEBHOOK_NESTJS is not set',
      ]);
    });

    it('rejects a URL that is not a Discord webhook, without printing it', () => {
      const leaked = 'https://evil.example.com/api/webhooks/1/leaked-token';
      const issues = issuesOf(VALID_YAML, {
        ...BASE_ENV,
        DISCORD_WEBHOOK_NUXT: leaked,
      });

      expect(issues.join('\n')).toContain(
        'DISCORD_WEBHOOK_NUXT is not a Discord webhook URL',
      );
      expect(issues.join('\n')).not.toContain('leaked-token');
    });

    it('rejects an http Discord URL', () => {
      const env = {
        ...BASE_ENV,
        DISCORD_WEBHOOK_NUXT: NUXT_HOOK.replace('https', 'http'),
      };

      expect(issuesOf(VALID_YAML, env)).toHaveLength(1);
    });
  });

  describe('environment', () => {
    it('rejects an invalid cron expression', () => {
      expect(
        issuesOf(VALID_YAML, { ...BASE_ENV, POLL_CRON: 'every hour' }),
      ).toContainEqual(expect.stringContaining('env POLL_CRON'));
    });

    it('rejects an http push URL without printing it', () => {
      const issues = issuesOf(VALID_YAML, {
        ...BASE_ENV,
        UPTIME_KUMA_PUSH_URL: 'http://kuma.local/api/push/push-secret',
      });

      expect(issues.join('\n')).toContain('env UPTIME_KUMA_PUSH_URL');
      expect(issues.join('\n')).not.toContain('push-secret');
    });

    it('reports every problem at once', () => {
      const issues = issuesOf(feedYaml({ url: 'http://x.y' }), {
        POLL_CRON: 'nope',
      });

      expect(issues.length).toBeGreaterThanOrEqual(2);
    });
  });
});
