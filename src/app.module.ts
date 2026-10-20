import { Module } from '@nestjs/common';
import { ConfigModule } from './config/index.js';
import { FetcherModule } from './fetcher/index.js';
import { ParserModule } from './parser/index.js';
import { StoreModule } from './store/index.js';

/**
 * Root module. Feature modules are added here as they are built
 * (see docs/PLAN.md, section 8):
 * DiscordModule, SchedulerModule.
 */
@Module({
  imports: [ConfigModule, FetcherModule, ParserModule, StoreModule],
})
export class AppModule {}
