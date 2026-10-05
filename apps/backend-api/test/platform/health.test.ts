import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { healthRoutes, runChecks, type HealthCheck } from '../../src/platform/health.js';
import { createLogger } from '../../src/platform/logger.js';
import { testRedisUrl } from '../support/db-urls.js';

const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
  REDIS_URL: testRedisUrl(),
});
const logger = createLogger(config);

const ok = (name: string): HealthCheck => ({ name, check: () => Promise.resolve() });
const failing = (name: string): HealthCheck => ({ name, check: () => Promise.reject(new Error('down')) });
const hanging = (name: string): HealthCheck => ({ name, check: () => new Promise(() => {}) });

const app = (checks: HealthCheck[], timeoutMs = 50) =>
  createApp({ config, logger, mountRoot: healthRoutes(checks, timeoutMs) });

describe('runChecks', () => {
  it('reports each dependency and an overall result', async () => {
    expect(await runChecks([ok('postgres'), failing('redis')], 50)).toEqual({
      ok: false,
      checks: { postgres: 'ok', redis: 'failed' },
    });
  });

  it('times out a hanging check instead of waiting forever', async () => {
    const started = Date.now();
    expect(await runChecks([hanging('postgres')], 50)).toEqual({
      ok: false,
      checks: { postgres: 'timeout' },
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('GET /health/ready', () => {
  it('returns 200 when every dependency answers', async () => {
    const res = await request(app([ok('postgres'), ok('redis')])).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', checks: { postgres: 'ok', redis: 'ok' } });
  });

  it('returns 503 naming the failed dependency', async () => {
    const res = await request(app([ok('postgres'), failing('redis')])).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable', checks: { postgres: 'ok', redis: 'failed' } });
  });

  it('is not cached by proxies', async () => {
    const res = await request(app([ok('postgres')])).get('/health/ready');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('GET /health/live', () => {
  it('answers without touching any dependency', async () => {
    const check = vi.fn(() => Promise.resolve());
    const res = await request(app([{ name: 'postgres', check }])).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(check).not.toHaveBeenCalled();
  });
});
