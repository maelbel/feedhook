import { readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';
import { AppConfig, type FeedConfig } from './app-config.js';
import { ConfigError } from './config.error.js';
import {
  DISCORD_WEBHOOK,
  envSchema,
  feedsFileSchema,
} from './config.schema.js';
import { Secret } from './secret.js';

/** Reads one environment variable (process.env, .env, or a test double). */
export type EnvReader = (name: string) => string | undefined;
/** Reads the feeds file; injectable so tests need no real file. */
export type FileReader = (path: string) => string;

/** feeds.yaml is a few lines: anything bigger is a mistake. */
const MAX_FEEDS_FILE_BYTES = 64 * 1024;

export function readFeedsFile(path: string): string {
  const { size } = statSync(path);
  if (size > MAX_FEEDS_FILE_BYTES) {
    throw new Error(`file is larger than ${MAX_FEEDS_FILE_BYTES} bytes`);
  }
  return readFileSync(path, 'utf8');
}

/**
 * Builds the validated `AppConfig`, or throws a `ConfigError` listing every
 * problem at once (env and feeds file), so they can all be fixed in one go.
 *
 * Messages name variables and fields, never their values: a webhook URL must
 * not end up in a terminal or a log because of a typo.
 */
export function loadAppConfig(
  getEnv: EnvReader,
  readFile: FileReader = readFeedsFile,
): AppConfig {
  const issues: string[] = [];

  // 1. Environment variables
  const envResult = envSchema.safeParse({
    FEEDS_FILE: getEnv('FEEDS_FILE'),
    POLL_CRON: getEnv('POLL_CRON'),
    DATA_DIR: getEnv('DATA_DIR'),
    UPTIME_KUMA_PUSH_URL: getEnv('UPTIME_KUMA_PUSH_URL'),
  });
  if (!envResult.success) {
    issues.push(...formatIssues(envResult.error, 'env '));
  }
  const feedsPath = resolve(getEnv('FEEDS_FILE') || 'feeds.yaml');
  const label = basename(feedsPath);

  // 2. feeds.yaml: read, parse YAML, validate the shape
  let feeds: FeedConfig[] = [];
  const raw = readFeeds(feedsPath, readFile, label, issues);
  if (raw !== undefined) {
    const fileResult = feedsFileSchema.safeParse(raw);
    if (!fileResult.success) {
      issues.push(...formatIssues(fileResult.error, `${label}: `));
    } else {
      // 3. Resolve each feed's webhook from the environment variable it names
      feeds = fileResult.data.feeds.map((feed, index) => {
        const where = `${label}: feeds[${index}].webhookEnv:`;
        const url = getEnv(feed.webhookEnv)?.trim();
        if (!url) {
          issues.push(
            `${where} environment variable ${feed.webhookEnv} is not set`,
          );
        } else if (!DISCORD_WEBHOOK.test(url)) {
          issues.push(
            `${where} environment variable ${feed.webhookEnv} is not a Discord webhook URL ` +
              '(expected https://discord.com/api/webhooks/<id>/<token>)',
          );
        }
        return Object.freeze({
          id: feed.id,
          name: feed.name,
          url: feed.url,
          color: Number.parseInt(feed.color.slice(1), 16),
          webhookUrl: new Secret(url ?? ''),
        });
      });
    }
  }

  if (issues.length > 0 || !envResult.success) {
    throw new ConfigError(issues);
  }

  const env = envResult.data;
  return new AppConfig(
    Object.freeze(feeds),
    env.POLL_CRON,
    env.DATA_DIR,
    env.UPTIME_KUMA_PUSH_URL ? new Secret(env.UPTIME_KUMA_PUSH_URL) : undefined,
  );
}

function readFeeds(
  path: string,
  readFile: FileReader,
  label: string,
  issues: string[],
): unknown {
  let text: string;
  try {
    text = readFile(path);
  } catch (error) {
    issues.push(`${label}: cannot read ${path} (${describe(error)})`);
    return undefined;
  }
  try {
    // `uniqueKeys` rejects a key written twice; `maxAliasCount` blocks
    // "billion laughs" alias bombs.
    return parseYaml(text, { uniqueKeys: true, maxAliasCount: 20 });
  } catch (error) {
    issues.push(`${label}: invalid YAML (${describe(error)})`);
    return undefined;
  }
}

/** `["feeds", 1, "url"]` -> `feeds[1].url` */
function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((out, key) => {
    if (typeof key === 'number') return `${out}[${key}]`;
    return out ? `${out}.${String(key)}` : String(key);
  }, '');
}

function formatIssues(error: z.ZodError, prefix: string): string[] {
  return error.issues.map((issue) => {
    const path = formatPath(issue.path);
    return `${prefix}${path ? `${path}: ` : ''}${issue.message}`;
  });
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    // Node fs errors have a short code (ENOENT, EACCES): enough to act on.
    const code = (error as NodeJS.ErrnoException).code;
    return code ?? error.message.split('\n')[0];
  }
  return String(error);
}
