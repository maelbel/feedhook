import { Test } from '@nestjs/testing';
import { AppModule } from './app.module.js';

describe('AppModule', () => {
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

  it('compiles', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
