// `GET /me/viewer` (F-037) through the platform's route mounting, against a real database and the real
// rate-limit gate. Skipped unless KOMTRU_INFRA_TESTS=1.
//
// The point is the negatives: a trade only counts as sold when the caller was its seller and the money
// reached them, and a merchant capability only counts while it is ACTIVE.
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { viewerFactsSchema } from '@komtru/shared-types';
import { viewerRoutes } from '../../../../src/modules/trades/http/viewer.routes.js';
import { errorHandler, notFound } from '../../../../src/platform/errors.js';
import { mountRoutes } from '../../../../src/platform/http/mount.js';
import { createRateLimitGate } from '../../../../src/platform/http/rateLimit.js';
import { ANONYMOUS_ACTOR, actorFor } from '../../../../src/platform/http/principal.js';
import { testPrincipal } from '../../../support/actors.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { createTestRedis, redisReady, testLogger } from '../../identity/support.js';
import { person, tradeAt } from '../services/fulfilment-support.js';

describe.runIf(infraEnabled)('GET /me/viewer', () => {
  const t = useTestDatabase();
  let redis: Redis;
  beforeAll(async () => {
    redis = createTestRedis();
    await redisReady(redis);
  });
  afterAll(async () => {
    await redis.quit();
  });

  const appFor = (userId: string | null) => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    mountRoutes(
      viewerRoutes(() => ({ db: t.db() })),
      {
        logger: testLogger,
        resolveActor: () =>
          Promise.resolve(userId === null ? ANONYMOUS_ACTOR : actorFor(testPrincipal(userId))),
        rateLimit: createRateLimitGate({ redis, logger: testLogger, keyPrefix: `viewer-${randomUUID()}` }),
        idempotency: (_input, run) => run(),
      },
    )(router);
    app.use('/v1', router);
    app.use(notFound);
    app.use(errorHandler(testLogger, () => undefined));
    return request(app);
  };

  const factsOf = async (userId: string) => {
    const response = await appFor(userId).get('/v1/me/viewer');
    expect(response.status).toBe(200);
    expect(viewerFactsSchema.strict().safeParse(response.body).success).toBe(true);
    return response.body as { hasSold: boolean; certifiedMerchant: boolean };
  };

  const capability = (userId: string, status: string) =>
    t
      .owner()
      .query(
        `INSERT INTO identity.user_capabilities (user_id, capability, status) VALUES ($1, 'MERCHANT', $2)`,
        [userId, status],
      );

  it('answers nobody who is not signed in', async () => {
    expect((await appFor(null).get('/v1/me/viewer')).status).toBe(401);
  });

  it('says nothing has been sold, and no certification, for someone who has done nothing', async () => {
    expect(await factsOf(await person(t))).toEqual({ hasSold: false, certifiedMerchant: false });
  });

  it.each(['COMPLETED', 'SETTLED', 'RESOLVED_RELEASED'])(
    'counts a %s trade for its seller',
    async (status) => {
      const trade = await tradeAt(t, status);
      expect((await factsOf(trade.seller)).hasSold).toBe(true);
    },
  );

  it('does not count that trade for its buyer', async () => {
    const trade = await tradeAt(t, 'COMPLETED');
    expect((await factsOf(trade.buyer)).hasSold).toBe(false);
  });

  it.each(['PENDING_PAYMENT', 'FUNDED', 'INSPECTION', 'CANCELLED_REFUNDED', 'RESOLVED_REFUNDED'])(
    'does not count a %s trade: the money has not reached the seller',
    async (status) => {
      const trade = await tradeAt(t, status);
      expect((await factsOf(trade.seller)).hasSold).toBe(false);
    },
  );

  it('reports certification only while the merchant capability is ACTIVE', async () => {
    const active = await person(t);
    await capability(active, 'ACTIVE');
    expect((await factsOf(active)).certifiedMerchant).toBe(true);

    for (const status of ['PENDING', 'SUSPENDED', 'REVOKED']) {
      const other = await person(t);
      await capability(other, status);
      expect((await factsOf(other)).certifiedMerchant, status).toBe(false);
    }
  });
});
