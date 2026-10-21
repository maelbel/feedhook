import { validateCronExpression } from 'cron';
import { z } from 'zod';

/** `nuxt-blog`, `nestjs-releases`: lowercase words separated by dashes. */
const FEED_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** `DISCORD_WEBHOOK_NUXT`: the usual shape of an environment variable name. */
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
/**
 * https://discord.com/api/webhooks/<id>/<token>, also accepting the
 * discordapp.com, canary and ptb hosts and a versioned API path.
 */
export const DISCORD_WEBHOOK =
  /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+$/;
/**
 * Five fields (minute hour day month weekday), or six with seconds, checked
 * by the same `cron` library the scheduler uses: an expression that passes
 * here is one the scheduler can run.
 */
const isCron = (value: string): boolean => validateCronExpression(value).valid;

const MAX_FEEDS = 50;

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    // Credentials in a URL would end up in logs and requests: refuse them.
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

const httpsUrl = z
  .string()
  .refine(isHttpsUrl, 'must be an https:// URL without credentials');

/** Turns `VAR=` (empty) into "not set", so defaults apply. */
const emptyAsUnset = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/**
 * One entry of feeds.yaml. `strictObject` rejects unknown keys, so a typo
 * like `webhookenv` is reported instead of silently ignored.
 */
const feedSchema = z.strictObject({
  id: z
    .string()
    .regex(
      FEED_ID,
      'must be lowercase letters, digits and dashes, like nuxt-blog',
    ),
  name: z.string().trim().min(1, 'must not be empty').max(100),
  url: httpsUrl,
  color: z.string().regex(HEX_COLOR, 'must be a hex colour like #00DC82'),
  webhookEnv: z
    .string()
    .regex(
      ENV_NAME,
      'must be an environment variable name like DISCORD_WEBHOOK_NUXT',
    ),
});

export const feedsFileSchema = z
  .strictObject({
    feeds: z
      .array(feedSchema)
      .min(1, 'must contain at least one feed')
      .max(MAX_FEEDS, `must contain at most ${MAX_FEEDS} feeds`),
  })
  .superRefine((file, ctx) => {
    // Ids are the keys of the store: two feeds must never share one.
    const seen = new Set<string>();
    file.feeds.forEach((feed, index) => {
      if (seen.has(feed.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['feeds', index, 'id'],
          message: `duplicate id "${feed.id}"`,
        });
      }
      seen.add(feed.id);
    });
  });

export const envSchema = z.object({
  FEEDS_FILE: z.preprocess(emptyAsUnset, z.string().default('feeds.yaml')),
  POLL_CRON: z.preprocess(
    emptyAsUnset,
    z
      .string()
      .trim()
      .refine(isCron, 'must be a cron expression like "0 * * * *"')
      .default('0 * * * *'),
  ),
  DATA_DIR: z.preprocess(emptyAsUnset, z.string().trim().default('./data')),
  UPTIME_KUMA_PUSH_URL: z.preprocess(emptyAsUnset, httpsUrl.optional()),
});

export type FeedsFile = z.infer<typeof feedsFileSchema>;
export type Env = z.infer<typeof envSchema>;
