import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { createLogger } from '../../src/platform/logger.js';
import { defineRoute } from '../../src/platform/http/route.js';
import { defineModule, moduleHealthChecks, mountModules } from '../../src/platform/module.js';
import { z } from 'zod';

const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
  REDIS_URL: 'redis://localhost:56379',
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
