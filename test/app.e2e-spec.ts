import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { AppConfig } from '../src/config/index.js';
import { DB_FILE_NAME, StoreService } from '../src/store/index.js';

describe('feedhook (e2e)', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'feedhook-e2e-'));
    vi.stubEnv('DATA_DIR', dataDir);
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
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('boots as a standalone application with a valid config and shuts down cleanly', async () => {
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });

    await app.init();
    expect(app.get(AppConfig).feeds).toHaveLength(2);

    // The store is open and its database file lives in DATA_DIR.
    app.get(StoreService).seed('nuxt-blog', ['a']);
    expect(existsSync(join(dataDir, DB_FILE_NAME))).toBe(true);

    await expect(app.close()).resolves.toBeUndefined();
  });
});
