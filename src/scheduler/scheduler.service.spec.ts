import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AppConfig } from '../config/index.js';
import type { CycleService } from './cycle.service.js';
import { POLL_JOB, SchedulerService } from './scheduler.service.js';

function setup(options: { running?: boolean; fails?: boolean } = {}) {
  const calls = { run: 0, stop: 0, idle: 0 };
  const cycle = {
    get isRunning() {
      return options.running ?? false;
    },
    run: async () => {
      calls.run++;
      if (options.fails) throw new Error('database is locked');
    },
    stop: () => {
      calls.stop++;
    },
    idle: async () => {
      calls.idle++;
    },
  } as unknown as CycleService;
  const registry = new SchedulerRegistry();
  const config = new AppConfig([], '*/30 * * * *', './data', undefined);
  const service = new SchedulerService(config, cycle, registry);
  return { service, registry, calls };
}

describe('SchedulerService', () => {
  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  it('schedules the cycle with POLL_CRON and runs it once at startup', async () => {
    const { service, registry, calls } = setup();

    service.onApplicationBootstrap();
    await Promise.resolve();

    const job = registry.getCronJob(POLL_JOB);
    expect(job.cronTime.source).toBe('*/30 * * * *');
    expect(job.isActive).toBe(true);
    expect(calls.run).toBe(1);

    await service.onModuleDestroy();
  });

  it('stops the schedule and waits for the running cycle on shutdown', async () => {
    const { service, registry, calls } = setup();
    service.onApplicationBootstrap();

    await service.onModuleDestroy();

    expect(registry.doesExist('cron', POLL_JOB)).toBe(false);
    expect(calls.stop).toBe(1);
    expect(calls.idle).toBe(1);
  });

  it('skips a run while the previous cycle is still running', async () => {
    const { service, calls } = setup({ running: true });

    await service.tick('schedule');

    expect(calls.run).toBe(0);
  });

  it('never throws when a cycle fails, so the schedule goes on', async () => {
    const { service, calls } = setup({ fails: true });

    await expect(service.tick('schedule')).resolves.toBeUndefined();
    expect(calls.run).toBe(1);
  });
});
