import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { AppConfig } from '../src/config/index.js';

describe('feedhook (e2e)', () => {
  beforeEach(() => {
    vi.stubEnv('FEEDS_FILE', 'test/fixtures/feeds.valid.yaml');
    vi.stubEnv(
      'DISCORD_WEBHOOK_NUXT',
      'https://discord.com/api/webhooks/1/nuxt',
    );
    vi.stubEnv(
      'DISCORD_WEBHOOK_NESTJS',
      'https://discord.com/api/webhooks/2/nest',
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('boots as a standalone application with a valid config and shuts down cleanly', async () => {
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });

    await app.init();
    expect(app.get(AppConfig).feeds).toHaveLength(2);
    await expect(app.close()).resolves.toBeUndefined();
  });
});
