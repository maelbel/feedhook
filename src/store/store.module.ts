import { Module } from '@nestjs/common';
import { StoreService } from './store.service.js';

/** The database is opened on startup and closed on shutdown. */
@Module({
  providers: [StoreService],
  exports: [StoreService],
})
export class StoreModule {}
