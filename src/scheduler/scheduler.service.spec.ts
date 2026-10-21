import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AppConfig } from '../config/index.js';
import type { MonitoringService } from '../monitoring/index.js';
import type { CycleService } from './cycle.service.js';
import type { CycleReport } from './cycle.types.js';
import { POLL_JOB, SchedulerService } from './scheduler.service.js';

const REPORT: CycleReport = {
  startedAt: new Date(),
  durationMs: 12,
  feeds: [],
  ok: true,
};

function setup(
  options: { running?: boolean; fails?: boolean; cron?: string } = {},
) {
  const calls = { run: 0, stop: 0, idle: 0 };
  const monitored: { report: CycleReport; intervalMs: number }[] = [];
  const cycle = {
    get isRunning() {
      return options.running ?? false;
    },
    run: async () => {
      calls.run++;
      if (options.fails) throw new Error('database is locked');
      return REPORT;
    },
    stop: () => {
      calls.stop++;
    },
    idle: async () => {
      calls.idle++;
    },
  } as unknown as CycleService;
  const monitoring = {
    afterCycle: async (report: CycleReport, intervalMs: number) => {
      monitored.push({ report, intervalMs });
    },
  } as unknown as MonitoringService;
  const registry = new SchedulerRegistry();
  const config = new AppConfig(
    [],
    options.cron ?? '*/30 * * * *',
    './data',
    undefined,
  );
  const service = new SchedulerService(config, cycle, registry, monitoring);
  return { service, registry, calls, monitored };
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

  it('tells monitoring about each cycle, with the interval derived from POLL_CRON', async () => {
    const { service, monitored } = setup({ cron: '*/30 * * * *' });
    service.onApplicationBootstrap();

    await service.tick('schedule');

    expect(monitored.at(-1)).toEqual({
      report: REPORT,
      intervalMs: 30 * 60_000,
    });
    await service.onModuleDestroy();
  });

  it('derives a daily interval from a daily schedule', async () => {
    const { service, monitored } = setup({ cron: '0 8 * * *' });
    service.onApplicationBootstrap();

    await service.tick('schedule');

    expect(monitored.at(-1)?.intervalMs).toBe(24 * 60 * 60_000);
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
    const { service, calls, monitored } = setup({ running: true });

    await service.tick('schedule');

    expect(calls.run).toBe(0);
    expect(monitored).toEqual([]);
  });

  it('never throws when a cycle fails, and sends no heartbeat for it', async () => {
    const { service, calls, monitored } = setup({ fails: true });

    await expect(service.tick('schedule')).resolves.toBeUndefined();
    expect(calls.run).toBe(1);
    expect(monitored).toEqual([]);
  });
});
