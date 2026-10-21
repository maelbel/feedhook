import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfig } from '../config/index.js';
import { MonitoringService } from '../monitoring/index.js';
import { CycleService } from './cycle.service.js';

export const POLL_JOB = 'poll-feeds';

/**
 * Starts the poll cycle: once at startup, then on `POLL_CRON` (every hour by
 * default). After each cycle, monitoring is told (heartbeat file for the
 * Docker healthcheck, Uptime Kuma push). On shutdown it stops the schedule
 * and lets the running cycle
 * finish its current post, before the database is closed (Nest destroys
 * modules in reverse order, so this runs before StoreModule closes).
 */
@Injectable()
export class SchedulerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(SchedulerService.name);
  /** Time between two scheduled runs, from POLL_CRON (used by monitoring). */
  private pollIntervalMs = 60 * 60_000;

  constructor(
    private readonly config: AppConfig,
    private readonly cycle: CycleService,
    private readonly registry: SchedulerRegistry,
    private readonly monitoring: MonitoringService,
  ) {}

  onApplicationBootstrap(): void {
    const job = CronJob.from({
      cronTime: this.config.pollCron,
      onTick: () => this.tick('schedule'),
      start: true,
    });
    this.registry.addCronJob(POLL_JOB, job);
    const [next, after] = job.nextDates(2);
    this.pollIntervalMs = after.toMillis() - next.toMillis();
    this.logger.log(
      `polling on "${this.config.pollCron}", next run at ${job.nextDate().toISO()}`,
    );

    void this.tick('startup');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.registry.doesExist('cron', POLL_JOB)) {
      await this.registry.getCronJob(POLL_JOB).stop();
      this.registry.deleteCronJob(POLL_JOB);
    }
    this.cycle.stop();
    if (this.cycle.isRunning) {
      this.logger.log('shutting down: letting the current post finish');
    }
    await this.cycle.idle();
    this.logger.log('scheduler stopped');
  }

  /** Never throws: a failed cycle is logged and the schedule goes on. */
  async tick(reason: 'startup' | 'schedule'): Promise<void> {
    if (this.cycle.isRunning) {
      this.logger.warn(
        `previous cycle still running, skipping this ${reason} run`,
      );
      return;
    }
    try {
      const report = await this.cycle.run();
      await this.monitoring.afterCycle(report, this.pollIntervalMs);
    } catch (error) {
      this.logger.error(
        `cycle failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
    }
  }
}
