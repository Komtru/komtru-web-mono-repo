import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import { configModule } from '../../../src/modules/config/index.js';
import { modules } from '../../../src/modules/index.js';
import { mountRoutes } from '../../../src/platform/http/mount.js';
import { assertRouteInvariants } from '../../../src/platform/http/route.js';
import { createLogger } from '../../../src/platform/logger.js';
import { testRedisUrl } from '../../support/db-urls.js';

const config = loadConfig({
  LOG_LEVEL: 'silent',
  POSTGRES_URL: 'postgresql://x@localhost/x',
  REDIS_URL: testRedisUrl(),
});
const logger = createLogger(config);
const app = createApp({
  config,
  logger,
  onUnexpected: () => {},
  mountV1: mountRoutes(configModule.routes ?? [], { logger }),
});

describe('GET /v1/config/fees', () => {
  it('serves the current schedule for display, with money as strings', async () => {
    const response = await request(app).get('/v1/config/fees').expect(200);
    expect(response.body).toEqual({
      version: '2026-10-05.1',
      currency: 'NGN',
      buyerProtectionFee: { rateBps: 150, minMinor: '0', maxMinor: null, refundableOnFullRefund: true },
      sellerCommission: { rateBps: 0, minMinor: '0', maxMinor: null },
      merchantCommission: { rateBps: 0, minMinor: '0', maxMinor: null },
      parkCashHandlingFee: { minMinor: '30000', maxMinor: '50000' },
      payoutFee: { amountMinor: '0' },
    });
  });

  it('passes the route registry invariants', () => {
    expect(() => assertRouteInvariants(configModule.routes ?? [])).not.toThrow();
  });
});

describe('the module registry', () => {
  it('holds the config module, so the fee file is validated at boot', () => {
    expect(modules.map((module) => module.name)).toContain('config');
  });
});
