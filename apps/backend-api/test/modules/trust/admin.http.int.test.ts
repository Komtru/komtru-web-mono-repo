// T-052's routes through the platform's route mounting, against a real database: the permission gates
// of T-037's catalogue, the reason rule, the strict decision body, and a review item taken and decided
// over HTTP. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../src/db/index.js';
import { registerCase } from '../../../src/modules/cases/index.js';
import { createIdentityAuth } from '../../../src/modules/identity/index.js';
import { trustAdminRoutes } from '../../../src/modules/trust/http/admin.routes.js';
import { errorHandler, notFound } from '../../../src/platform/errors.js';
import { mountRoutes } from '../../../src/platform/http/mount.js';
import { actorFor, type Actor } from '../../../src/platform/http/principal.js';
import { testPrincipal } from '../../support/actors.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { createTestRedis, redisReady, seedUser, testConfig, testLogger } from '../identity/support.js';

interface Body {
  [key: string]: unknown;
}
const json = (res: request.Response) => res.body as Body;

describe.runIf(infraEnabled)('trust admin routes (T-052)', () => {
  const t = useTestDatabase();
  const db = (): Db => createDb(t.app());
  let redis: Redis;
  beforeAll(async () => {
    redis = createTestRedis();
    await redisReady(redis);
  });
  afterAll(async () => {
    await redis.quit();
  });

  const staff = async (permissions: string[]): Promise<{ userId: string; actor: Actor }> => {
    const { userId } = await seedUser(t.app());
    return {
      userId,
      actor: actorFor(
        testPrincipal(userId, { scope: 'STAFF', permissions: new Set(permissions), roles: ['KYC_ANALYST'] }),
      ),
    };
  };

  const appFor = (actor: Actor) => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    mountRoutes(trustAdminRoutes({ db }), {
      logger: testLogger,
      onDenied: createIdentityAuth({ db: db(), redis, config: testConfig(), logger: testLogger })
        .onAccessDenied,
      resolveActor: () => Promise.resolve(actor),
      rateLimit: () => Promise.resolve(),
      idempotency: (_input, run) => run(),
    })(router);
    app.use('/v1', router);
    app.use(notFound);
    app.use(errorHandler(testLogger, () => undefined));
    return app;
  };

  /** A request parked for a person, with its case, written the way the jobs write them. */
  const parked = async (): Promise<string> => {
    const { userId } = await seedUser(t.app());
    const { rows } = await t.owner().query<{ id: string }>(
      `INSERT INTO trust.verification_requests
         (user_id, verification_type, status, target_level, attempt_count, expires_at)
       VALUES ($1, 'ADDRESS', 'MANUAL_REVIEW', 4, 1, now() + interval '1 day') RETURNING id`,
      [userId],
    );
    const id = rows[0]?.id ?? randomUUID();
    await t.owner().query(
      `INSERT INTO trust.address_checks (request_id, user_id, address_line1, city, state, method)
       VALUES ($1, $2, '1 Allen Avenue', 'Ikeja', 'Lagos', 'UTILITY_BILL')`,
      [id, userId],
    );
    await db().transaction((tx) =>
      registerCase(tx, {
        type: 'IDENTITY',
        subjectType: 'verification_request',
        subjectId: id,
        title: 'ADDRESS needs a manual check',
        facts: { duplicateIdentity: false },
      }),
    );
    return id;
  };

  it('gates every route on its catalogue permission', async () => {
    const requestId = await parked();
    const none = request(appFor((await staff([])).actor));
    expect((await none.get('/v1/kyc/queue')).status).toBe(404); // mounted under /admin
    expect((await none.get('/v1/admin/kyc/queue')).status).toBe(403);
    expect((await none.get(`/v1/admin/kyc/queue/${requestId}`)).status).toBe(403);
    expect((await none.post(`/v1/admin/kyc/queue/${requestId}/assign`).send({})).status).toBe(403);
    expect((await none.get('/v1/admin/kyc/duplicate-flags')).status).toBe(403);
    expect(
      (
        await none
          .post(`/v1/admin/kyc/duplicate-flags/${randomUUID()}/resolve`)
          .send({ resolution: 'ESCALATED' })
      ).status,
    ).toBe(403);
    expect(
      (await none.post('/v1/admin/kyc/overrides').send({ kind: 'CLEAR_DUPLICATE', flagId: randomUUID() }))
        .status,
    ).toBe(403);

    // Viewing is not reviewing.
    const viewer = request(appFor((await staff(['verification.view'])).actor));
    expect((await viewer.get('/v1/admin/kyc/queue')).status).toBe(200);
    expect((await viewer.post(`/v1/admin/kyc/queue/${requestId}/assign`).send({})).status).toBe(403);
  });

  it('serves the queue and an item with a labelled advisory', async () => {
    const requestId = await parked();
    const app = request(appFor((await staff(['verification.view'])).actor));
    const list = await app.get('/v1/admin/kyc/queue?type=IDENTITY');
    expect(list.status).toBe(200);
    expect(json(list)).toMatchObject({ total: 1, page: 1 });
    expect(((json(list).items as Body[])[0] ?? {}).requestId).toBe(requestId);
    expect((await app.get('/v1/admin/kyc/queue?type=NONSENSE')).status).toBe(422);

    const detail = json(await app.get(`/v1/admin/kyc/queue/${requestId}`));
    expect((detail.advisory as Body).label).toBe('AI-suggested — not a decision');
    expect((await app.get(`/v1/admin/kyc/queue/${randomUUID()}`)).status).toBe(404);
  });

  it('takes and decides over HTTP, demanding a reason and refusing unknown members', async () => {
    const requestId = await parked();
    const app = request(appFor((await staff(['verification.view', 'verification.review'])).actor));
    expect((await app.post(`/v1/admin/kyc/queue/${requestId}/assign`).send({})).status).toBe(200);

    expect(
      (await app.post(`/v1/admin/kyc/queue/${requestId}/decide`).send({ outcome: 'APPROVE' })).status,
    ).toBe(400);
    // An advisory has no field to ride in on.
    expect(
      (
        await app
          .post(`/v1/admin/kyc/queue/${requestId}/decide`)
          .send({ outcome: 'APPROVE', reason: 'x', advisory: { suggestion: 'approve' } })
      ).status,
    ).toBe(422);

    const decided = await app
      .post(`/v1/admin/kyc/queue/${requestId}/decide`)
      .set('X-Admin-Reason', 'Utility bill is legible and current')
      .send({ outcome: 'APPROVE' });
    expect(decided.status).toBe(200);
    expect(json(decided)).toEqual({ requestId, status: 'APPROVED' });
    const { rows } = await t
      .owner()
      .query<{ passed: boolean }>(`SELECT passed FROM trust.address_checks WHERE request_id = $1`, [
        requestId,
      ]);
    expect(rows[0]?.passed).toBe(true);
    // Off the open queue now.
    expect(json(await app.get('/v1/admin/kyc/queue')).total).toBe(0);
    expect(json(await app.get('/v1/admin/kyc/queue?show=all')).total).toBe(1);
  });
});
