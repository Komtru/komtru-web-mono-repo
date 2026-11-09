// The self-arranged ship response carries a `shipment` member beyond the pinned trade-view fields.
// The route's response schema is a loose object so it must pass that member through untouched; this
// pins it through the real router, not just the schema.
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../../src/app.js';
import { loadConfig } from '../../../../src/config/env.js';
import { fulfilmentRoutes } from '../../../../src/modules/trades/http/fulfilment.routes.js';
import { mountRoutes } from '../../../../src/platform/http/mount.js';
import { createLogger } from '../../../../src/platform/logger.js';
import { testRedisEnv, testRedisUrl } from '../../../support/db-urls.js';

const USER = '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b';
const TRADE = '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a01';

const shipped = {
  id: TRADE,
  tradeCode: 'KMT-1000001-NG',
  status: 'SHIPPED',
  statusRevision: 7,
  yourRole: 'SELLER',
  shipment: { method: 'SELF_ARRANGED', waybillNumber: 'WB-123456', vehiclePlate: 'ABC-123 DE' },
};

vi.mock('../../../../src/modules/trades/services/fulfilment.service.js', () => ({
  getShipOptions: vi.fn(),
  shipSelfArranged: vi.fn(() => Promise.resolve(shipped)),
}));

const config = loadConfig({
  LOG_LEVEL: 'silent',
  POSTGRES_URL: 'postgresql://x@localhost/x',
  REDIS_URL: testRedisUrl(),
  ...testRedisEnv(),
});
const logger = createLogger(config);

const actor = {
  key: `user:${USER}`,
  principal: {
    userId: USER,
    publicId: 'KMT-U-7F3K9Q',
    sessionId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5c',
    familyId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5d',
    scope: 'CONSUMER' as const,
    status: 'ACTIVE' as const,
    sessionsEpoch: 1,
    amr: ['pwd'],
    roles: [],
    permissions: new Set<string>(),
    companyMembership: null,
  },
};

describe('POST /trades/:id/ship/self-arranged through the router', () => {
  it('returns the trade view with its shipment member intact', async () => {
    const app = createApp({
      config,
      logger,
      onUnexpected: () => {},
      mountV1: mountRoutes(
        fulfilmentRoutes(() => ({}) as never),
        {
          logger,
          resolveActor: () => Promise.resolve(actor),
          // Pass-through gates: this test is about the response shape, not replay or throttling.
          idempotency: (_context, run) => run(),
          rateLimit: () => Promise.resolve(),
        },
      ),
    });
    const res = await request(app).post(`/v1/trades/${TRADE}/ship/self-arranged`).send({
      waybillNumber: 'WB-123456',
      receiptFileId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a02',
      driverPhone: '08031234567',
      vehiclePlate: 'abc-123 de',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'SHIPPED', yourRole: 'SELLER', shipment: shipped.shipment });
  });
});
