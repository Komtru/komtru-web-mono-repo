// Runs against the local Docker stack (`pnpm infra:up`). Skipped unless KOMTRU_INFRA_TESTS=1.
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { createClients, postgresCheck, redisCheck } from '../../src/platform/clients.js';
import { healthRoutes } from '../../src/platform/health.js';
import { createLogger } from '../../src/platform/logger.js';
import { testRedisUrl } from '../support/db-urls.js';

const enabled = process.env.KOMTRU_INFRA_TESTS === '1';

describe.runIf(enabled)('readiness against real dependencies', () => {
  const env = {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
    REDIS_URL: testRedisUrl(),
  };
  const config = loadConfig(env);
  const logger = createLogger(config);
  const clients = createClients(config);
  // A pool aimed at a port nothing listens on, to prove readiness reports the failure.
  const broken = createClients(
    loadConfig({ ...env, POSTGRES_URL: env.POSTGRES_URL.replace('56432', '59999') }),
  );

  afterAll(async () => {
    await clients.close();
    await broken.close();
  });

  it('is ready when Postgres (through PgBouncer) and Redis answer', async () => {
    const app = createApp({
      config,
      logger,
      mountRoot: healthRoutes([postgresCheck(clients.pool), redisCheck(clients.redis)]),
    });
    const res = await request(app).get('/health/ready');
    expect(res.body).toEqual({ status: 'ok', checks: { postgres: 'ok', redis: 'ok' } });
  });

  it('reports Postgres as failed when it is unreachable', async () => {
    const app = createApp({
      config,
      logger,
      mountRoot: healthRoutes([postgresCheck(broken.pool), redisCheck(clients.redis)]),
    });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable', checks: { postgres: 'failed', redis: 'ok' } });
  });
});
