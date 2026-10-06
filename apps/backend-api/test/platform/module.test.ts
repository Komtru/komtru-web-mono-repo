import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { createLogger } from '../../src/platform/logger.js';
import { defineRoute } from '../../src/platform/http/route.js';
import { defineModule, moduleHealthChecks, mountModules, runModuleSeeds } from '../../src/platform/module.js';
import { z } from 'zod';
import { testRedisUrl } from '../support/db-urls.js';

const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
  REDIS_URL: testRedisUrl(),
});
const logger = createLogger(config);

const trades = defineModule({
  name: 'trades',
  routes: [
    defineRoute({
      method: 'get',
      path: '/trades/ping',
      scope: 'PUBLIC',
      summary: 'Module liveness',
      schema: { response: z.object({ module: z.string() }) },
      handler: () => Promise.resolve({ module: 'trades' }),
    }),
  ],
  healthChecks: [{ name: 'trades-cache', check: () => Promise.resolve() }],
});

describe('module registry', () => {
  it('mounts each module’s routes under /v1', async () => {
    const app = createApp({ config, logger, mountV1: mountModules([trades], { logger }) });
    const res = await request(app).get('/v1/trades/ping');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ module: 'trades' });
  });

  it('refuses two modules with the same name', () => {
    expect(() => mountModules([trades, defineModule({ name: 'trades' })], { logger })).toThrow(
      /duplicate module "trades"/,
    );
  });

  it('collects health checks from every module', () => {
    expect(moduleHealthChecks([trades, defineModule({ name: 'identity' })]).map((c) => c.name)).toEqual([
      'trades-cache',
    ]);
  });
});

describe('module seeds', () => {
  it('runs each module seed once, in registry order', async () => {
    const order: string[] = [];
    const db = {} as never;
    await runModuleSeeds(
      [
        defineModule({ name: 'a', seed: () => Promise.resolve(void order.push('a')) }),
        defineModule({ name: 'b' }),
        defineModule({ name: 'c', seed: () => Promise.resolve(void order.push('c')) }),
      ],
      db,
    );
    expect(order).toEqual(['a', 'c']);
  });

  it('names the module whose seed failed', async () => {
    await expect(
      runModuleSeeds(
        [defineModule({ name: 'identity', seed: () => Promise.reject(new Error('boom')) })],
        {} as never,
      ),
    ).rejects.toThrow(/identity/);
  });
});
