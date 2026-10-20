import { Module } from '@nestjs/common';
import { ConfigModule } from './config/index.js';
import { FetcherModule } from './fetcher/index.js';

/**
 * Root module. Feature modules are added here as they are built
 * (see docs/PLAN.md, section 8):
 * ParserModule, StoreModule, DiscordModule, SchedulerModule.
 */
@Module({
  imports: [ConfigModule, FetcherModule],
})
export class AppModule {}
