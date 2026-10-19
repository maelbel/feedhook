import { Module } from '@nestjs/common';

/**
 * Root module. Feature modules are added here as they are built
 * (see docs/PLAN.md, section 8):
 * ConfigModule, FetcherModule, ParserModule, StoreModule, DiscordModule,
 * SchedulerModule.
 */
@Module({
  imports: [],
})
export class AppModule {}
