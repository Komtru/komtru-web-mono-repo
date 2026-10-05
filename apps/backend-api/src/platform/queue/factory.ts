// BullMQ queues for all external I/O (design §4). Producers exist in every process; consumers only in
// the worker, so a slow provider never blocks the API's event loop.
//
// Failure policy: exponential backoff, capped attempts, then the job is copied to `<name>.dead`,
// counted, logged at error level and handed to `onDeadLetter` (the ops event, once the bus exists).
import { Queue, Worker, type Job } from 'bullmq';
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
  /** Workers first (in-flight jobs finish), then queues, then their connections. */
  close(): Promise<void>;
}

export interface QueueFactoryOptions {
  redisUrl: string;
  logger: Logger;
  onDeadLetter?: (letter: DeadLetter) => void;
}

export function createQueueFactory({ redisUrl, logger, onDeadLetter }: QueueFactoryOptions): QueueFactory {
  const queues = new Map<string, Queue>();
  const definitions = new Map<string, QueueDefinition<never>>();
  const workers: Worker[] = [];
  const connections: Redis[] = [];
  const connection = () => {
    const redis = createBullConnection(redisUrl);
    connections.push(redis);
    return redis;
  };

  const producer = <T>(name: string): Queue<T> => {
    let queue = queues.get(name);
    if (!queue) {
      const definition = definitions.get(name);
      queue = new Queue(name, {
        connection: connection(),
        prefix: BULL_PREFIX,
        defaultJobOptions: {
          attempts: definition?.attempts ?? DEFAULT_ATTEMPTS,
          backoff: { type: 'exponential', delay: definition?.backoffMs ?? DEFAULT_BACKOFF_MS },
          removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
          // Failures outlive successes: they are what an operator needs to find.
          removeOnFail: { age: 30 * 24 * 60 * 60 },
        },
      });
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
    onDeadLetter?.(letter);
  };

  const define = (definition: QueueDefinition<never>): void => {
    if (queues.has(definition.name) && !definitions.has(definition.name)) {
      throw new Error(`queue: define '${definition.name}' before producing to it`);
    }
    definitions.set(definition.name, definition);
  };

  const consume = <T>(definition: QueueDefinition<T>): Worker<T> => {
    define(definition);
    const worker = new Worker<T>(definition.name, (job) => definition.process(job.data, job), {
      connection: connection(),
      prefix: BULL_PREFIX,
      concurrency: definition.concurrency ?? 1,
    });
    worker.on('failed', (job, error) => {
      // Fires on every failed attempt; only the last one dead-letters.
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) void deadLetter(job, error, job.attemptsMade);
    });
    workers.push(worker);
    return worker;
  };

  return {
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
