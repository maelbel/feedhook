import { Module } from '@nestjs/common';
import { ConfigModule } from './config/index.js';
import { SchedulerModule } from './scheduler/index.js';

/**
 * Root module. The scheduler imports the feature modules it drives
 * (fetcher, parser, store, discord); the config is global.
 */
@Module({
  imports: [ConfigModule, SchedulerModule],
})
export class AppModule {}
