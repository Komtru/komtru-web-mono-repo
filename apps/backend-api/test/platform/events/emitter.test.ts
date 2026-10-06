import { defineEvent } from '@komtru/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { loadConfig } from '../../../src/config/env.js';
import { createInProcessEmitter } from '../../../src/platform/events/emitter.js';
import { createLogger } from '../../../src/platform/logger.js';
import { testRedisEnv, testRedisUrl } from '../../support/db-urls.js';

const logger = createLogger(
  loadConfig({
    LOG_LEVEL: 'silent',
    POSTGRES_URL: 'postgresql://x@localhost/x',
    REDIS_URL: testRedisUrl(),
    ...testRedisEnv(),
  }),
);

const cacheInvalidated = defineEvent('platform.cache.invalidated', 1, z.object({ key: z.string() }));
const socketFanout = defineEvent('platform.socket.fanout', 1, z.object({ room: z.string() }));

describe('in-process emitter', () => {
  it('delivers to every listener in registration order', () => {
    const emitter = createInProcessEmitter(logger);
    const calls: string[] = [];
    emitter.on(cacheInvalidated, () => calls.push('first'));
    emitter.on(cacheInvalidated, ({ key }) => calls.push(`second:${key}`));

    emitter.emit(cacheInvalidated, { key: 'user:1' });

    expect(calls).toEqual(['first', 'second:user:1']);
  });

  it('delivers only to listeners of that event type', () => {
    const emitter = createInProcessEmitter(logger);
    const other = vi.fn();
    emitter.on(socketFanout, other);
    emitter.emit(cacheInvalidated, { key: 'user:1' });
    expect(other).not.toHaveBeenCalled();
  });

  it('keeps going when a listener throws, and never fails the caller', () => {
    const emitter = createInProcessEmitter(logger);
    const after = vi.fn();
    emitter.on(cacheInvalidated, () => {
      throw new Error('listener exploded');
    });
    emitter.on(cacheInvalidated, after);

    expect(() => emitter.emit(cacheInvalidated, { key: 'user:1' })).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('swallows a rejected async listener', async () => {
    const emitter = createInProcessEmitter(logger);
    emitter.on(cacheInvalidated, () => Promise.reject(new Error('async boom')));
    expect(() => emitter.emit(cacheInvalidated, { key: 'user:1' })).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('stops delivering once a listener is removed', () => {
    const emitter = createInProcessEmitter(logger);
    const listener = vi.fn();
    const off = emitter.on(cacheInvalidated, listener);
    off();
    emitter.emit(cacheInvalidated, { key: 'user:1' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('is in-process only: another instance sees nothing', () => {
    const emitter = createInProcessEmitter(logger);
    const elsewhere = createInProcessEmitter(logger);
    const listener = vi.fn();
    elsewhere.on(cacheInvalidated, listener);

    emitter.emit(cacheInvalidated, { key: 'user:1' });

    expect(listener).not.toHaveBeenCalled();
  });
});
