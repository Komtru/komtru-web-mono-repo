// Queue factory against real Redis. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config/env.js';
import { createLogger } from '../../src/platform/logger.js';
import { createQueueFactory, type QueueFactory } from '../../src/platform/queue/factory.js';
import { deadLetterCounter } from '../../src/platform/queue/metrics.js';
import { BULL_PREFIX, createRedis } from '../../src/platform/redis/connections.js';
import { infraEnabled } from '../support/db-urls.js';
import { eventually } from '../support/eventually.js';

const redisUrl = 'redis://localhost:56379';
const logger = createLogger(
  loadConfig({ LOG_LEVEL: 'silent', POSTGRES_URL: 'postgresql://x@localhost/x', REDIS_URL: redisUrl }),
);
const ready = async (redis: ReturnType<typeof createRedis>) => {
  if (redis.status !== 'ready') await new Promise((resolve) => redis.once('ready', resolve));
  return redis;
};
const unique = (label: string) => `test.${label}-${randomUUID().slice(0, 8)}`;

describe.runIf(infraEnabled)('queue factory', () => {
  let factory: QueueFactory | undefined;
  afterEach(async () => factory?.close());

  it('prefixes app keys with komtru:', async () => {
    const redis = await ready(createRedis(redisUrl));
    const key = `probe-${randomUUID()}`;
    try {
      await redis.set(key, '1', 'EX', 30);
      const raw = await ready(createRedis(redisUrl, { prefix: false }));
      try {
        expect(await raw.get(`komtru:${key}`)).toBe('1');
      } finally {
        raw.disconnect();
      }
    } finally {
      redis.disconnect();
    }
  });

  it('processes a job once, under the komtru:bull prefix', async () => {
    factory = createQueueFactory({ redisUrl, logger });
    const name = unique('ok');
    const seen: number[] = [];
    factory.consume<{ n: number }>({ name, process: ({ n }) => Promise.resolve(void seen.push(n)) });
    await factory.producer<{ n: number }>(name).add('run', { n: 7 });
    await eventually(() => seen.length === 1);
    expect(seen).toEqual([7]);
    const raw = await ready(createRedis(redisUrl, { prefix: false }));
    try {
      expect(await raw.keys(`${BULL_PREFIX}:${name}:*`)).not.toEqual([]);
    } finally {
      raw.disconnect();
    }
  });

  it('retries with backoff, then dead-letters once on the last attempt', async () => {
    const onDeadLetter = vi.fn();
    factory = createQueueFactory({ redisUrl, logger, onDeadLetter });
    const name = unique('fails');
    let attempts = 0;
    factory.consume({
      name,
      attempts: 3,
      backoffMs: 10,
      process: () => {
        attempts += 1;
        return Promise.reject(new Error('provider down'));
      },
    });
    const before = deadLetterCounter.snapshot()[name] ?? 0;
    await factory.producer(name).add('run', { order: 'A1' });

    const dead = factory.producer(`${name}.dead`);
    await eventually(async () => (await dead.getJobCounts('waiting')).waiting === 1);
    await new Promise((r) => setTimeout(r, 200)); // nothing more arrives
    expect(attempts).toBe(3);
    expect((await dead.getJobCounts('waiting')).waiting).toBe(1);
    const [letter] = await dead.getJobs(['waiting']);
    expect(letter?.data).toMatchObject({
      queue: name,
      data: { order: 'A1' },
      error: 'provider down',
      attempts: 3,
    });
    expect(deadLetterCounter.snapshot()[name]).toBe(before + 1);
    expect(onDeadLetter).toHaveBeenCalledOnce();
  });

  it('does not dead-letter a job that succeeds on a retry', async () => {
    const onDeadLetter = vi.fn();
    factory = createQueueFactory({ redisUrl, logger, onDeadLetter });
    const name = unique('flaky');
    let attempts = 0;
    factory.consume({
      name,
      attempts: 3,
      backoffMs: 10,
      process: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error('blip')) : Promise.resolve();
      },
    });
    await factory.producer(name).add('run', {});
    await eventually(() => attempts === 2);
    await new Promise((r) => setTimeout(r, 200));
    expect((await factory.producer(`${name}.dead`).getJobCounts('waiting')).waiting).toBe(0);
    expect(onDeadLetter).not.toHaveBeenCalled();
  });
});
