// Cannibalized from kumtru/backend-apis/src/modules/scheduler/infrastructure/queue.ts (T-001), adapted
// to injected dependencies and the komtru: key prefix.
//
// The BullMQ transport for recurring work. Worker process only. Each occurrence goes to exactly one
// worker across the fleet, so a non-idempotent sweep (e.g. a payout run) never runs N times.
import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from '../logger.js';
import { BULL_PREFIX, createBullConnection } from '../redis/connections.js';
import type { ScheduleRegistry } from './registry.js';

export const SCHEDULER_QUEUE_NAME = 'scheduler.cron';

interface CronPayload {
  job: string;
}

export interface SchedulerOptions {
  registry: ScheduleRegistry;
  redisUrl: string;
  timezone: string;
  logger: Logger;
  queueName?: string;
  /** BullMQ key namespace. Production uses the default; the integration suite passes a per-worker one. */
  prefix?: string;
  /** Sweeps run one at a time: latency nobody waits on beats lock contention with live traffic. */
  concurrency?: number;
}

export interface RunningScheduler {
  /** Scheduler ids removed at start because no registered job has that name. */
  pruned: string[];
  /** Worker first, then the queue, then connections. Schedules stay in Redis: they are fleet state. */
  stop(): Promise<void>;
}

/** Whether a handler's result means work was done; for log level only. */
const didSomething = (result: unknown): boolean => {
  if (result === undefined || result === null) return false;
  if (typeof result === 'number') return result > 0;
  if (typeof result === 'boolean') return result;
  if (Array.isArray(result)) return result.length > 0;
  if (typeof result === 'object') return Object.values(result).some((value) => didSomething(value));
  return true;
};

export async function startScheduler({
  registry,
  redisUrl,
  timezone,
  logger,
  queueName = SCHEDULER_QUEUE_NAME,
  prefix = BULL_PREFIX,
  concurrency = 1,
}: SchedulerOptions): Promise<RunningScheduler> {
  const connections: Redis[] = [];
  const connection = () => {
    const redis = createBullConnection(redisUrl);
    connections.push(redis);
    return redis;
  };
  const queue = new Queue<CronPayload>(queueName, {
    connection: connection(),
    prefix,
    defaultJobOptions: {
      // No retry: every job is a sweep over what is overdue, so the next occurrence is the retry.
      attempts: 1,
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1_000 },
      removeOnFail: { age: 30 * 24 * 60 * 60 },
    },
  });

  const declared = registry.list();
  // The scheduler id is the job name, so concurrent workers upsert the same schedule, not one each.
  for (const job of declared) {
    await queue.upsertJobScheduler(
      job.name,
      { pattern: job.cron, tz: timezone },
      { name: 'run', data: { job: job.name } },
    );
  }

  // A schedule persists across deploys; one whose job was renamed or removed would fire forever.
  const registered = new Set(declared.map((job) => job.name));
  const pruned: string[] = [];
  for (const scheduler of await queue.getJobSchedulers()) {
    const id = scheduler.key;
    if (!id || registered.has(id)) continue;
    await queue.removeJobScheduler(id);
    pruned.push(id);
  }
  if (pruned.length) logger.info({ pruned }, 'scheduler: removed schedules with no registered job');

  const worker = new Worker<CronPayload>(
    queueName,
    async (occurrence: Job<CronPayload>) => {
      const job = registry.get(occurrence.data.job);
      // A pruned schedule can leave an occurrence queued; failing it would page someone for nothing.
      if (!job) {
        logger.warn({ job: occurrence.data.job }, 'scheduler: occurrence for an unregistered job, skipped');
        return { skipped: true };
      }
      const startedAt = Date.now();
      const firedAt = occurrence.opts.prevMillis ? new Date(occurrence.opts.prevMillis) : new Date();
      const result = await job.handler(firedAt);
      const durationMs = Date.now() - startedAt;
      if (didSomething(result)) logger.info({ job: job.name, durationMs, result }, 'scheduler: job did work');
      else logger.debug({ job: job.name, durationMs }, 'scheduler: job ran, nothing to do');
      return result;
    },
    { connection: connection(), prefix, concurrency },
  );
  worker.on('failed', (occurrence, error) => {
    logger.error(
      { err: error, job: occurrence?.data.job },
      'scheduler: job threw; the next occurrence retries',
    );
  });

  logger.info(
    { queue: queueName, timezone, jobs: declared.map((j) => `${j.name} @ ${j.cron}`) },
    declared.length ? 'scheduler: started' : 'scheduler: started with no jobs',
  );

  return {
    pruned,
    async stop() {
      await worker.close();
      await queue.close();
      await Promise.all(connections.map((c) => c.quit().catch(() => c.disconnect())));
    },
  };
}
