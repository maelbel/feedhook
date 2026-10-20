import { Test } from '@nestjs/testing';
import { AppConfig } from './app-config.js';
import { ConfigError } from './config.error.js';
import { ConfigModule } from './config.module.js';

const ENV = {
  FEEDS_FILE: 'test/fixtures/feeds.valid.yaml',
  DISCORD_WEBHOOK_NUXT: 'https://discord.com/api/webhooks/1/nuxt',
  DISCORD_WEBHOOK_NESTJS: 'https://discord.com/api/webhooks/2/nest',
};

describe('ConfigModule', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('provides AppConfig from the feeds file and the environment', async () => {
    for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule],
    }).compile();
    const config = moduleRef.get(AppConfig);

    expect(config.feeds.map((feed) => feed.id)).toEqual([
      'nuxt-blog',
      'nestjs-releases',
    ]);
    await moduleRef.close();
  });

  it('fails to start when the configuration is invalid', async () => {
    vi.stubEnv('FEEDS_FILE', ENV.FEEDS_FILE);
    vi.stubEnv('DISCORD_WEBHOOK_NUXT', ENV.DISCORD_WEBHOOK_NUXT);
    vi.stubEnv('DISCORD_WEBHOOK_NESTJS', '');

    await expect(
      Test.createTestingModule({ imports: [ConfigModule] }).compile(),
    ).rejects.toBeInstanceOf(ConfigError);
  });
});
