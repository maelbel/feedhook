import { Module } from '@nestjs/common';
import { FETCH_FN } from '../fetcher/fetcher.types.js';
import { DiscordService } from './discord.service.js';
import {
  DEFAULT_DISCORD_OPTIONS,
  DISCORD_OPTIONS,
  SLEEP_FN,
  sleep,
} from './discord.types.js';

@Module({
  providers: [
    DiscordService,
    { provide: DISCORD_OPTIONS, useValue: DEFAULT_DISCORD_OPTIONS },
    { provide: SLEEP_FN, useValue: sleep },
    // Node's built-in fetch, looked up at call time.
    {
      provide: FETCH_FN,
      useValue: (...args: Parameters<typeof fetch>) =>
        globalThis.fetch(...args),
    },
  ],
  exports: [DiscordService],
})
export class DiscordModule {}
