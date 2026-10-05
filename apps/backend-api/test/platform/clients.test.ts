import { EventEmitter } from 'node:events';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { redisCheck } from '../../src/platform/clients.js';

const fakeRedis = (status: string) => Object.assign(new EventEmitter(), { status }) as unknown as Redis;

describe('redisCheck', () => {
  it('fails within its own timeout and removes its listeners when Redis never becomes ready', async () => {
    const redis = fakeRedis('reconnecting');
    const check = redisCheck(redis, 20);
    for (let i = 0; i < 5; i++) await expect(check.check()).rejects.toThrow(/not ready/);
    expect(redis.listenerCount('ready')).toBe(0);
    expect(redis.listenerCount('end')).toBe(0);
  });

  it('fails without waiting when the connection has ended', async () => {
    const redis = fakeRedis('end');
    await expect(redisCheck(redis, 5000).check()).rejects.toThrow(/ended/);
    expect(redis.listenerCount('ready')).toBe(0);
  });
});
