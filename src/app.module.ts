import { Module } from '@nestjs/common';
import { ConfigModule } from './config/index.js';

/**
 * Root module. Feature modules are added here as they are built
 * (see docs/PLAN.md, section 8):
 * FetcherModule, ParserModule, StoreModule, DiscordModule, SchedulerModule.
 */
@Module({
  imports: [ConfigModule],
})
export class AppModule {}
