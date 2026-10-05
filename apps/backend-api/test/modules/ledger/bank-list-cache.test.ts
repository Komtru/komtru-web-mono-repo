import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import {
  BANK_LIST_CACHE_KEY,
  BANK_LIST_TTL_SECONDS,
  createRedisBankListCache,
} from '../../../src/modules/ledger/infrastructure/bankListCache.js';

/** The two commands the cache uses, and nothing else — no Redis runs in this suite. */
const fakeRedis = (seed: Record<string, string> = {}) => {
  const store = new Map(Object.entries(seed));
  const calls: { key: string; ttl: number }[] = [];
  const redis = {
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    set: (key: string, value: string, mode: string, ttl: number) => {
      expect(mode).toBe('EX');
      calls.push({ key, ttl });
      store.set(key, value);
      return Promise.resolve('OK');
    },
  } as unknown as Redis;
  return { redis, calls, store };
};

const BANKS = [
  { name: 'Access Bank', code: '044' },
  { name: 'Zenith Bank', code: '057' },
];

describe('the bank list cache', () => {
  it('reads back what it wrote, under its own key and TTL', async () => {
    const { redis, calls } = fakeRedis();
    const cache = createRedisBankListCache(redis);

    await cache.write(BANKS);

    expect(calls).toEqual([{ key: BANK_LIST_CACHE_KEY, ttl: BANK_LIST_TTL_SECONDS }]);
    await expect(cache.read()).resolves.toEqual(BANKS);
  });

  it('outlives one failed refresh', () => {
    // The refresh runs daily; a TTL shorter than two intervals would empty the cache after one
    // failure, which is the moment the list is most needed.
    expect(BANK_LIST_TTL_SECONDS).toBeGreaterThan(2 * 24 * 60 * 60);
  });

  it('reads null when nothing is cached', async () => {
    await expect(createRedisBankListCache(fakeRedis().redis).read()).resolves.toBeNull();
  });

  it.each([
    ['not JSON', 'not json'],
    ['JSON of the wrong shape', '{"banks":[]}'],
    ['an array of the wrong shape', '[{"bankName":"Access"}]'],
  ])('reads null, not a throw, when the cached value is %s', async (_name, stored) => {
    // A cache written by an older format must look empty to its caller, never crash it.
    const { redis } = fakeRedis({ [BANK_LIST_CACHE_KEY]: stored });
    await expect(createRedisBankListCache(redis).read()).resolves.toBeNull();
  });
});
