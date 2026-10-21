import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DiscordModule } from '../discord/index.js';
import { FetcherModule } from '../fetcher/index.js';
import { MonitoringModule } from '../monitoring/index.js';
import { ParserModule } from '../parser/index.js';
import { StoreModule } from '../store/index.js';
import { CycleService } from './cycle.service.js';
import { CYCLE_OPTIONS, DEFAULT_CYCLE_OPTIONS } from './cycle.types.js';
import { SchedulerService } from './scheduler.service.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    FetcherModule,
    ParserModule,
    StoreModule,
    DiscordModule,
    MonitoringModule,
  ],
  providers: [
    CycleService,
    SchedulerService,
    { provide: CYCLE_OPTIONS, useValue: DEFAULT_CYCLE_OPTIONS },
  ],
  exports: [CycleService],
})
export class SchedulerModule {}
