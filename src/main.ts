import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

/**
 * feedhook runs as a NestJS *standalone application*: there is no HTTP
 * server and no open port. The app only makes outbound requests (feeds,
 * Discord webhooks) from scheduled jobs, which keeps the attack surface small.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);

  // Close modules cleanly on SIGTERM/SIGINT (docker stop, Ctrl+C).
  app.enableShutdownHooks();

  new Logger('Bootstrap').log('feedhook started');
}

await bootstrap();
