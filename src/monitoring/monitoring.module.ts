import { Module } from '@nestjs/common';
import { FETCH_FN } from '../fetcher/fetcher.types.js';
import { MonitoringService } from './monitoring.service.js';

@Module({
  providers: [
    MonitoringService,
    // Node's built-in fetch, looked up at call time.
    {
      provide: FETCH_FN,
      useValue: (...args: Parameters<typeof fetch>) =>
        globalThis.fetch(...args),
    },
  ],
  exports: [MonitoringService],
})
export class MonitoringModule {}
