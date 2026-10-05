// The scheduler against real Redis. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/env.js';
import { createLogger } from '../../src/platform/logger.js';
import { BULL_PREFIX, createBullConnection } from '../../src/platform/redis/connections.js';
import { createScheduleRegistry, type ScheduledJob } from '../../src/platform/scheduler/registry.js';
import { startScheduler, type RunningScheduler } from '../../src/platform/scheduler/scheduler.js';
import { infraEnabled } from '../support/db-urls.js';
import { eventually } from '../support/eventually.js';

const redisUrl = 'redis://localhost:56379';
const logger = createLogger(
  loadConfig({ LOG_LEVEL: 'silent', POSTGRES_URL: 'postgresql://x@localhost/x', REDIS_URL: redisUrl }),
);

describe.runIf(infraEnabled)('scheduler', () => {
  const running: RunningScheduler[] = [];
  const opened: Queue[] = [];
  afterEach(async () => {
    await Promise.all(running.splice(0).map((s) => s.stop()));
    await Promise.all(opened.splice(0).map((q) => q.obliterate({ force: true }).then(() => q.close())));
  });

  const setup = (jobs: ScheduledJob[]) => {
    const queueName = `test.scheduler-${randomUUID().slice(0, 8)}`;
    const registry = createScheduleRegistry();
    for (const job of jobs) registry.register(job);
    const queue = new Queue(queueName, { connection: createBullConnection(redisUrl), prefix: BULL_PREFIX });
    opened.push(queue);
    const start = async () => {
      const scheduler = await startScheduler({
        registry,
        redisUrl,
        timezone: 'Africa/Lagos',
        logger,
        queueName,
      });
      running.push(scheduler);
      return scheduler;
    };
    return { queue, start, registry };
  };
  const job = (name: string, handler: ScheduledJob['handler'] = () => Promise.resolve(0)): ScheduledJob => ({
    name,
    cron: '0 2 * * *',
    description: 'test',
    handler,
  });

  it('schedules in Africa/Lagos: 02:00 daily is 01:00 UTC', async () => {
    const { queue, start } = setup([job('trades.nightly')]);
    await start();
    const [scheduler] = await queue.getJobSchedulers();
    expect(scheduler).toMatchObject({ key: 'trades.nightly', tz: 'Africa/Lagos', pattern: '0 2 * * *' });
    expect(new Date(Number(scheduler?.next)).getUTCHours()).toBe(1);
  });

  it('converges on one schedule per job when two workers start', async () => {
    const { queue, start } = setup([job('trades.nightly'), job('payouts.daily')]);
    await Promise.all([start(), start()]);
    expect((await queue.getJobSchedulers()).map((s) => s.key).sort()).toEqual([
      'payouts.daily',
      'trades.nightly',
    ]);
  });

  it('prunes schedules whose job is no longer registered', async () => {
    const { queue, start } = setup([job('trades.nightly')]);
    await queue.upsertJobScheduler('trades.renamed-away', { pattern: '0 3 * * *' }, { name: 'run' });
    const scheduler = await start();
    expect(scheduler.pruned).toEqual(['trades.renamed-away']);
    expect((await queue.getJobSchedulers()).map((s) => s.key)).toEqual(['trades.nightly']);
  });

  it('skips an occurrence for an unregistered job instead of failing it', async () => {
    const { queue, start } = setup([job('trades.nightly')]);
    await start();
    const occurrence = await queue.add('run', { job: 'trades.gone' });
    await eventually(async () => (await occurrence.getState()) === 'completed');
    expect((await queue.getJob(occurrence.id ?? ''))?.returnvalue).toEqual({ skipped: true });
  });

  it('passes the scheduled instant to the handler', async () => {
    const fired: Date[] = [];
    const { queue, start } = setup([job('trades.nightly', (at) => Promise.resolve(void fired.push(at)))]);
    await start();
    const scheduledFor = Date.UTC(2026, 9, 5, 1, 0, 0);
    await queue.add('run', { job: 'trades.nightly' }, { prevMillis: scheduledFor });
    await eventually(() => fired.length === 1);
    expect(fired[0]?.toISOString()).toBe(new Date(scheduledFor).toISOString());
  });
});
