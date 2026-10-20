import { Module } from '@nestjs/common';
import { FetcherService } from './fetcher.service.js';
import {
  DEFAULT_FETCHER_OPTIONS,
  FETCH_FN,
  FETCHER_OPTIONS,
} from './fetcher.types.js';

@Module({
  providers: [
    FetcherService,
    { provide: FETCHER_OPTIONS, useValue: DEFAULT_FETCHER_OPTIONS },
    // Node's built-in fetch, looked up at call time.
    {
      provide: FETCH_FN,
      useValue: (...args: Parameters<typeof fetch>) =>
        globalThis.fetch(...args),
    },
  ],
  exports: [FetcherService],
})
export class FetcherModule {}
