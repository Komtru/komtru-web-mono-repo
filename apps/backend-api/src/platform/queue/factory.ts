// BullMQ queues for all external I/O (design §4). Producers exist in every process; consumers only in
// the worker, so a slow provider never blocks the API's event loop.
//
// Failure policy: exponential backoff, capped attempts, then the job is copied to `<name>.dead`,
// counted, logged at error level and handed to `onDeadLetter` (the ops event, once the bus exists).
import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from '../logger.js';
import { BULL_PREFIX, createBullConnection } from '../redis/connections.js';
import { deadLetterCounter } from './metrics.js';

export const DEFAULT_ATTEMPTS = 5;
export const DEFAULT_BACKOFF_MS = 2_000;

export interface QueueDefinition<T = unknown> {
  /** `module.queue-name`, e.g. `notify.sms`. */
  name: string;
  process(data: T, job: Job<T>): Promise<unknown>;
  attempts?: number;
  /** First retry delay; doubles per attempt. */
  backoffMs?: number;
  concurrency?: number;
}

export interface DeadLetter {
  queue: string;
  jobId: string | undefined;
  name: string;
  data: unknown;
  error: string;
  attempts: number;
  failedAt: string;
}

export interface QueueFactory {
  /**
   * Registers a queue's retry policy. Every process defines the same queues (from the module list),
   * so producers in the API and consumers in the worker agree on attempts and backoff.
   */
  define(definition: QueueDefinition<never>): void;
  producer<T = unknown>(name: string): Queue<T>;
  /** Worker process only. Defines the queue too. */
  consume<T = unknown>(definition: QueueDefinition<T>): Worker<T>;
  /** Starts every consumer. Call once the process has finished starting. */
  run(): void;
  /** Workers first (in-flight jobs finish), then queues, then their connections. */
  close(): Promise<void>;
}

export interface QueueFactoryOptions {
  redisUrl: string;
  logger: Logger;
  onDeadLetter?: (letter: DeadLetter) => void;
  /**
   * BullMQ's key namespace. Defaults to the production one; the integration suite passes a per-worker
   * namespace so parallel test files cannot drain each other's queues. The dead-letter queue is
   * built through the same `producer()`, so it inherits this automatically.
   */
  prefix?: string;
}

/** How long an enqueue waits for Redis before failing (a request should not hang on an outage). */
export const ENQUEUE_READY_TIMEOUT_MS = 2_000;

export class QueueUnavailableError extends Error {
  constructor(readonly queue: string) {
    super(`queue '${queue}' is unavailable: Redis is not reachable`);
    this.name = 'QueueUnavailableError';
  }
}

const whenReady = (redis: Redis, timeoutMs: number): Promise<boolean> =>
  redis.status === 'ready'
    ? Promise.resolve(true)
    : new Promise((resolve) => {
        const done = (ready: boolean) => {
          clearTimeout(timer);
          redis.off('ready', onReady);
          resolve(ready);
        };
        const onReady = () => done(true);
        const timer = setTimeout(() => done(false), timeoutMs);
        redis.once('ready', onReady);
      });

/**
 * BullMQ waits for its connection indefinitely, so an enqueue during a Redis outage would hang the
 * HTTP request that made it. Bound the wait, then fail with QueueUnavailableError.
 */
function guardEnqueue(queue: Queue, redis: Redis): void {
  const add = queue.add.bind(queue);
  const addBulk = queue.addBulk.bind(queue);
  const ensure = async () => {
    if (!(await whenReady(redis, ENQUEUE_READY_TIMEOUT_MS))) throw new QueueUnavailableError(queue.name);
  };
  queue.add = (async (...args: Parameters<typeof add>) => {
    await ensure();
    return add(...args);
  }) as typeof add;
  queue.addBulk = (async (...args: Parameters<typeof addBulk>) => {
    await ensure();
    return addBulk(...args);
  }) as typeof addBulk;
}

export function createQueueFactory({
  redisUrl,
  logger,
  onDeadLetter,
  prefix = BULL_PREFIX,
}: QueueFactoryOptions): QueueFactory {
  const queues = new Map<string, Queue>();
  const definitions = new Map<string, QueueDefinition<never>>();
  const workers: Worker[] = [];
  const connections: Redis[] = [];
  const connection = (role: 'producer' | 'worker') => {
    const redis = createBullConnection(redisUrl, role);
    connections.push(redis);
    return redis;
  };

  const producer = <T>(name: string): Queue<T> => {
    let queue = queues.get(name);
    if (!queue) {
      const definition = definitions.get(name);
      const producerConnection = connection('producer');
      queue = new Queue(name, {
        connection: producerConnection,
        prefix,
        defaultJobOptions: {
          attempts: definition?.attempts ?? DEFAULT_ATTEMPTS,
          backoff: { type: 'exponential', delay: definition?.backoffMs ?? DEFAULT_BACKOFF_MS },
          removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
          // Failures outlive successes: they are what an operator needs to find.
          removeOnFail: { age: 30 * 24 * 60 * 60 },
        },
      });
      guardEnqueue(queue, producerConnection);
      queues.set(name, queue);
    }
    return queue as unknown as Queue<T>;
  };

  const deadLetter = async (job: Job, error: Error, attempts: number) => {
    const letter: DeadLetter = {
      queue: job.queueName,
      jobId: job.id,
      name: job.name,
      data: job.data,
      error: error.message,
      attempts,
      failedAt: new Date().toISOString(),
    };
    await producer(`${job.queueName}.dead`).add('dead-letter', letter, {
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    });
    deadLetterCounter.increment(job.queueName);
    logger.error({ queue: job.queueName, jobId: job.id, attempts, err: error }, 'queue: job dead-lettered');
    try {
      onDeadLetter?.(letter);
    } catch (hookError) {
      logger.error({ err: hookError, queue: job.queueName, jobId: job.id }, 'queue: onDeadLetter hook threw');
    }
  };

  const define = (definition: QueueDefinition<never>): void => {
    if (queues.has(definition.name) && !definitions.has(definition.name)) {
      throw new Error(`queue: define '${definition.name}' before producing to it`);
    }
    definitions.set(definition.name, definition);
  };

  const consume = <T>(definition: QueueDefinition<T>): Worker<T> => {
    define(definition);
    // autorun off: nothing is consumed until the process has finished starting (see run()).
    const worker = new Worker<T>(definition.name, (job) => definition.process(job.data, job), {
      autorun: false,
      connection: connection('worker'),
      prefix,
      concurrency: definition.concurrency ?? 1,
    });
    worker.on('failed', (job, error) => {
      // Fires on every failed attempt; only a final failure dead-letters. An UnrecoverableError is
      // final on any attempt.
      if (!job) return;
      const final = error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
      if (!final) return;
      deadLetter(job, error, job.attemptsMade).catch((dlqError: unknown) => {
        logger.error({ err: dlqError, queue: job.queueName, jobId: job.id }, 'queue: dead-lettering failed');
      });
    });
    workers.push(worker);
    return worker;
  };

  const run = () => {
    for (const worker of workers) {
      worker
        .run()
        .catch((error: unknown) => logger.error({ err: error, queue: worker.name }, 'queue: worker stopped'));
    }
  };

  return {
    run,
    define,
    producer,
    consume,
    async close() {
      await Promise.all(workers.map((w) => w.close()));
      await Promise.all([...queues.values()].map((q) => q.close()));
      await Promise.all(connections.map((c) => c.quit().catch(() => c.disconnect())));
    },
  };
}
