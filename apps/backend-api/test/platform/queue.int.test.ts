// Queue factory against real Redis. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { UnrecoverableError } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config/env.js';
import { createLogger } from '../../src/platform/logger.js';
import { createQueueFactory, type QueueFactory } from '../../src/platform/queue/factory.js';
import { deadLetterCounter } from '../../src/platform/queue/metrics.js';
import { KEY_PREFIX, createRedis } from '../../src/platform/redis/connections.js';
import { infraEnabled, testQueuePrefix, testRedisUrl } from '../support/db-urls.js';
import { eventually } from '../support/eventually.js';

const redisUrl = testRedisUrl();
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
    const redis = await ready(createRedis(redisUrl, { keyPrefix: KEY_PREFIX }));
    const key = `probe-${randomUUID()}`;
    try {
      await redis.set(key, '1', 'EX', 30);
      const raw = await ready(createRedis(redisUrl, { keyPrefix: false }));
      try {
        expect(await raw.get(`komtru:${key}`)).toBe('1');
      } finally {
        raw.disconnect();
      }
    } finally {
      redis.disconnect();
    }
  });

  it('writes app keys under the namespace it is given', async () => {
    const redis = await ready(createRedis(redisUrl, { keyPrefix: 'komtru_t9:' }));
    const key = `probe-${randomUUID()}`;
    try {
      await redis.set(key, '1', 'EX', 30);
      const raw = await ready(createRedis(redisUrl, { keyPrefix: false }));
      try {
        expect(await raw.get(`komtru_t9:${key}`)).toBe('1');
        expect(await raw.get(`komtru:${key}`)).toBeNull();
      } finally {
        raw.disconnect();
      }
    } finally {
      redis.disconnect();
    }
  });

  // The bug this ticket exists for: two Vitest workers share one Redis database, so without
  // separate prefixes one file's worker drains the other file's queue of the same name, and the
  // job is executed against the wrong test database.
  it('keeps two namespaces apart, so one consumer cannot drain the other', async () => {
    const name = unique('isolated');
    const a = createQueueFactory({ redisUrl, logger, prefix: 'komtru_a:bull' });
    const b = createQueueFactory({ redisUrl, logger, prefix: 'komtru_b:bull' });
    const seenA: number[] = [];
    const seenB: number[] = [];
    try {
      a.consume<{ n: number }>({ name, process: ({ n }) => Promise.resolve(void seenA.push(n)) });
      b.consume<{ n: number }>({ name, process: ({ n }) => Promise.resolve(void seenB.push(n)) });
      a.run();
      b.run();
      await a.producer<{ n: number }>(name).add('run', { n: 1 });
      await eventually(
        () => seenA.length === 1,
        5000,
        () => `seenA=${JSON.stringify(seenA)} seenB=${JSON.stringify(seenB)}`,
      );
      // b has had a live worker on the same queue name throughout; give it room to steal.
      await new Promise((r) => setTimeout(r, 300));
      expect(seenA).toEqual([1]);
      expect(seenB).toEqual([]);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });

  it('processes a job once, under the komtru:bull prefix', async () => {
    factory = createQueueFactory({ redisUrl, logger, prefix: testQueuePrefix() });
    const name = unique('ok');
    const seen: number[] = [];
    factory.consume<{ n: number }>({ name, process: ({ n }) => Promise.resolve(void seen.push(n)) });
    factory.run();
    await factory.producer<{ n: number }>(name).add('run', { n: 7 });
    await eventually(
      () => seen.length === 1,
      5000,
      () => `seen=${JSON.stringify(seen)}`,
    );
    expect(seen).toEqual([7]);
    const raw = await ready(createRedis(redisUrl, { keyPrefix: false }));
    try {
      expect(await raw.keys(`${testQueuePrefix()}:${name}:*`)).not.toEqual([]);
    } finally {
      raw.disconnect();
    }
  });

  it('retries with backoff, then dead-letters once on the last attempt', async () => {
    const onDeadLetter = vi.fn();
    factory = createQueueFactory({ redisUrl, logger, prefix: testQueuePrefix(), onDeadLetter });
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
    factory.run();
    await factory.producer(name).add('run', { order: 'A1' });

    const dead = factory.producer(`${name}.dead`);
    await eventually(
      async () => (await dead.getJobCounts('waiting')).waiting === 1,
      5000,
      async () => `attempts=${String(attempts)} dead=${JSON.stringify(await dead.getJobCounts())}`,
    );
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
    factory = createQueueFactory({ redisUrl, logger, prefix: testQueuePrefix(), onDeadLetter });
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
    factory.run();
    await factory.producer(name).add('run', {});
    await eventually(
      () => attempts === 2,
      5000,
      () => `attempts=${String(attempts)}`,
    );
    await new Promise((r) => setTimeout(r, 200));
    expect((await factory.producer(`${name}.dead`).getJobCounts('waiting')).waiting).toBe(0);
    expect(onDeadLetter).not.toHaveBeenCalled();
  });

  it('dead-letters an UnrecoverableError on its first attempt', async () => {
    const onDeadLetter = vi.fn();
    factory = createQueueFactory({ redisUrl, logger, prefix: testQueuePrefix(), onDeadLetter });
    const name = unique('unrecoverable');
    factory.consume({
      name,
      attempts: 3,
      backoffMs: 10,
      process: () => Promise.reject(new UnrecoverableError('bad payload')),
    });
    factory.run();
    await factory.producer(name).add('run', {});
    await eventually(
      () => onDeadLetter.mock.calls.length === 1,
      5000,
      async () =>
        `hookCalls=${String(onDeadLetter.mock.calls.length)} dead=${JSON.stringify(await factory?.producer(`${name}.dead`).getJobCounts())}`,
    );
    expect(onDeadLetter.mock.calls[0]?.[0]).toMatchObject({ error: 'bad payload', attempts: 1 });
  });

  it('survives an onDeadLetter hook that throws', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const onDeadLetter = vi.fn(() => {
        throw new Error('bus down');
      });
      factory = createQueueFactory({ redisUrl, logger, prefix: testQueuePrefix(), onDeadLetter });
      const name = unique('hook-throws');
      factory.consume({ name, attempts: 1, process: () => Promise.reject(new Error('x')) });
      factory.run();
      await factory.producer(name).add('run', {});
      await eventually(
        () => onDeadLetter.mock.calls.length === 1,
        5000,
        async () =>
          `hookCalls=${String(onDeadLetter.mock.calls.length)} dead=${JSON.stringify(await factory?.producer(`${name}.dead`).getJobCounts())}`,
      );
      await new Promise((r) => setTimeout(r, 100));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('fails an enqueue fast instead of hanging while Redis is unreachable', async () => {
    factory = createQueueFactory({ redisUrl: 'redis://127.0.0.1:1', logger, prefix: testQueuePrefix() });
    const started = Date.now();
    await expect(factory.producer(unique('down')).add('run', {})).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
