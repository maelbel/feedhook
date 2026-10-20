import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AppConfig, ConfigError } from './config/index.js';

/**
 * feedhook runs as a NestJS *standalone application*: there is no HTTP
 * server and no open port. The app only makes outbound requests (feeds,
 * Discord webhooks) from scheduled jobs, which keeps the attack surface small.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  try {
    // abortOnError: false makes startup errors reach the catch below
    // instead of Nest exiting on its own.
    const app = await NestFactory.createApplicationContext(AppModule, {
      abortOnError: false,
    });

    // Close modules cleanly on SIGTERM/SIGINT (docker stop, Ctrl+C).
    app.enableShutdownHooks();

    const config = app.get(AppConfig);
    logger.log(
      `feedhook started: ${config.feeds.length} feed(s) [${config.feeds
        .map((feed) => feed.id)
        .join(', ')}], schedule "${config.pollCron}"`,
    );
  } catch (error) {
    if (error instanceof ConfigError) {
      // Nest has already logged the list of issues (see ConfigError).
      logger.error('Startup aborted: fix the configuration above and restart.');
    } else {
      logger.error(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    }
    process.exitCode = 1;
  }
}

await bootstrap();
