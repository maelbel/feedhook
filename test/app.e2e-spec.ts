import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';

describe('feedhook (e2e)', () => {
  it('boots as a standalone application and shuts down cleanly', async () => {
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });

    await app.init();
    await expect(app.close()).resolves.toBeUndefined();
  });
});
