import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { createGeoCache } from '../../../src/modules/geo/infrastructure/redis/cache.js';
import type { Logger } from '../../../src/platform/logger.js';

const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as Logger;

function fakeRedis(options: { failing?: boolean } = {}) {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();
  const boom = () => Promise.reject(new Error('redis down'));
  const redis = {
    get: (key: string) => (options.failing ? boom() : Promise.resolve(store.get(key) ?? null)),
    set: (key: string, value: string, _ex: string, ttl: number) => {
      if (options.failing) return boom();
      store.set(key, value);
      ttls.set(key, ttl);
      return Promise.resolve('OK');
    },
    incr: (key: string) => {
      if (options.failing) return boom();
      const next = Number(store.get(key) ?? '0') + 1;
      store.set(key, String(next));
      return Promise.resolve(next);
    },
  };
  return { redis: redis as unknown as Redis, store, ttls };
}

describe('the geo cache', () => {
  it('loads once and serves the second read from Redis, with a TTL', async () => {
    const { redis, ttls } = fakeRedis();
    const cache = createGeoCache(redis, logger, 120);
    const load = vi.fn(() => Promise.resolve({ items: [1] }));
    expect(await cache.remember('states', load)).toEqual({ items: [1] });
    expect(await cache.remember('states', load)).toEqual({ items: [1] });
    expect(load).toHaveBeenCalledTimes(1);
    expect([...ttls.values()]).toEqual([120]);
  });

  it('keeps different keys apart', async () => {
    const cache = createGeoCache(fakeRedis().redis, logger);
    expect(await cache.remember('a', () => Promise.resolve(1))).toBe(1);
    expect(await cache.remember('b', () => Promise.resolve(2))).toBe(2);
  });

  it('retires every key with one invalidation, so the next read reloads', async () => {
    const cache = createGeoCache(fakeRedis().redis, logger);
    let version = 'old';
    const load = vi.fn(() => Promise.resolve(version));
    await cache.remember('cities:q:ik', load);
    await cache.remember('states', load);
    version = 'new';
    await cache.invalidate();
    expect(await cache.remember('cities:q:ik', load)).toBe('new');
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('cannot cache a value loaded before an invalidation under the new version', async () => {
    // The reader read version 0, is mid-query, and the writer commits and bumps to 1. The reader
    // then fills v0 (which nobody reads again), not v1.
    const cache = createGeoCache(fakeRedis().redis, logger);
    let release: (v: string) => void = () => undefined;
    const slow = new Promise<string>((resolve) => {
      release = resolve;
    });
    const reading = cache.remember('states', () => slow);
    await Promise.resolve();
    await cache.invalidate();
    release('stale');
    expect(await reading).toBe('stale');
    const fresh = vi.fn(() => Promise.resolve('fresh'));
    expect(await cache.remember('states', fresh)).toBe('fresh');
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('treats a mangled entry as a miss', async () => {
    const { redis, store } = fakeRedis();
    const cache = createGeoCache(redis, logger);
    store.set('geo:v0:states', '{not json');
    expect(await cache.remember('states', () => Promise.resolve('ok'))).toBe('ok');
  });

  it('falls through to the loader when Redis is down, and invalidate does not throw', async () => {
    const cache = createGeoCache(fakeRedis({ failing: true }).redis, logger);
    expect(await cache.remember('states', () => Promise.resolve('db'))).toBe('db');
    await expect(cache.invalidate()).resolves.toBeUndefined();
  });

  it('purge throws on a Redis failure so the outbox redelivers', async () => {
    const cache = createGeoCache(fakeRedis({ failing: true }).redis, logger);
    await expect(cache.purge()).rejects.toThrow('redis down');
  });
});
