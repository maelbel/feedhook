import { Global, Module } from '@nestjs/common';
import {
  ConfigModule as NestConfigModule,
  ConfigService,
} from '@nestjs/config';
import { AppConfig } from './app-config.js';
import { loadAppConfig } from './load-config.js';

/**
 * Provides the validated `AppConfig` to the whole app (`@Global`).
 *
 * `@nestjs/config` loads the `.env` file (when present) into the
 * `ConfigService`; we then read only the variables we need through it and
 * validate everything in `loadAppConfig`. If anything is wrong, startup
 * fails with a `ConfigError` before any feed is fetched.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      // Tests set their variables explicitly and must not depend on a
      // developer's local .env file.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
  ],
  providers: [
    {
      provide: AppConfig,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AppConfig =>
        loadAppConfig((name) => config.get<string>(name)),
    },
  ],
  exports: [AppConfig],
})
export class ConfigModule {}
