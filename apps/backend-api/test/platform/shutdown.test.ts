import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config/env.js';
import { createLogger } from '../../src/platform/logger.js';
import { initSentry, sentryOptions } from '../../src/platform/sentry.js';
import { gracefulShutdown } from '../../src/platform/shutdown.js';
import { testRedisEnv, testRedisUrl } from '../support/db-urls.js';

const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
  REDIS_URL: testRedisUrl(),
  ...testRedisEnv(),
});
const logger = createLogger(config);

describe('gracefulShutdown', () => {
  it('runs every closer in order, even when one throws', async () => {
    const order: string[] = [];
    const closer = (name: string, fail = false) => ({
      name,
      close: () => {
        order.push(name);
        return fail ? Promise.reject(new Error(`${name} broke`)) : Promise.resolve();
      },
    });
    const result = await gracefulShutdown({
      closers: [closer('http'), closer('modules', true), closer('clients')],
      timeoutMs: 1000,
      logger,
    });
    expect(order).toEqual(['http', 'modules', 'clients']);
    expect(result).toEqual({ clean: false, failed: ['modules'], timedOut: false });
  });

  it('gives up on a hanging closer at the timeout', async () => {
    const started = Date.now();
    const result = await gracefulShutdown({
      closers: [{ name: 'stuck', close: () => new Promise<void>(() => {}) }],
      timeoutMs: 50,
      logger,
    });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result).toEqual({ clean: false, failed: [], timedOut: true });
  });

  it('reports a clean shutdown when everything closes', async () => {
    const close = vi.fn(() => Promise.resolve());
    expect(await gracefulShutdown({ closers: [{ name: 'a', close }], timeoutMs: 100, logger })).toEqual({
      clean: true,
      failed: [],
      timedOut: false,
    });
  });
});

describe('sentryOptions', () => {
  it('collects no user info, cookies, headers, bodies or query strings', () => {
    const options = sentryOptions(
      { ...config, sentry: { dsn: 'https://k@o0.ingest.sentry.io/1', environment: 'test' } },
      'api',
    );
    expect(options.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    });
    expect(options.initialScope).toEqual({ tags: { process: 'api' } });
  });
});

describe('initSentry', () => {
  it('is a no-op without a DSN', async () => {
    const sentry = initSentry(config, 'api');
    expect(sentry.enabled).toBe(false);
    expect(() => sentry.captureException(new Error('x'))).not.toThrow();
    await expect(sentry.flush()).resolves.toBe(true);
  });
});
