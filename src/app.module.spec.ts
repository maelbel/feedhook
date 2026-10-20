import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module.js';

describe('AppModule', () => {
  let dataDir: string;

  beforeEach(() => {
    Logger.overrideLogger(false);
    dataDir = mkdtempSync(join(tmpdir(), 'feedhook-app-'));
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

  it('compiles', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
