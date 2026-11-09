// T-107's routes through the platform's route mounting, against a real database: permission gates,
// the reason rule, pagination, and the advisory leaving the database untouched.
import express from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../src/db/index.js';
import { ruleBasedAdvisory } from '../../../src/modules/cases/domain/advisory.js';
import { caseRoutes } from '../../../src/modules/cases/http/routes.js';
import { registerCase } from '../../../src/modules/cases/index.js';
import { createIdentityAuth } from '../../../src/modules/identity/index.js';
import { errorHandler, notFound } from '../../../src/platform/errors.js';
import { mountRoutes } from '../../../src/platform/http/mount.js';
import { actorFor, type Actor } from '../../../src/platform/http/principal.js';
import { testPrincipal } from '../../support/actors.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import {
  createTestRedis,
  grantRole,
  redisReady,
  seedUser,
  testConfig,
  testLogger,
} from '../identity/support.js';

interface Body {
  [key: string]: unknown;
}
const json = (res: request.Response) => res.body as Body;

describe.runIf(infraEnabled)('cases routes (T-107)', () => {
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
    if (permissions.includes('cases.manage'))
      await grantRole(t.owner(), userId, 'OPERATIONS_ADMIN', permissions);
    return {
      userId,
      actor: actorFor(testPrincipal(userId, { scope: 'STAFF', permissions: new Set(permissions) })),
    };
  };

  const appFor = (actor: Actor) => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    mountRoutes(caseRoutes({ db, advisory: () => ruleBasedAdvisory }), {
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
  const register = async (title: string, facts: Record<string, boolean | number> = {}) =>
    (
      await db().transaction((tx) =>
        registerCase(tx, { type: 'KYB', subjectType: 'kyb_review', subjectId: title, title, facts }),
      )
    ).case;
  const count = async (table: string) =>
    Number((await t.owner().query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]?.n);

  it('gates reads on cases.view and writes on cases.manage', async () => {
    const row = await register('a');
    const none = await staff([]);
    const viewer = await staff(['cases.view']);
    expect((await request(appFor(none.actor)).get('/v1/cases/queue')).status).toBe(403);
    expect((await request(appFor(viewer.actor)).get('/v1/cases/queue')).status).toBe(200);
    expect((await request(appFor(viewer.actor)).post(`/v1/cases/${row.id}/take`)).status).toBe(403);
  });

  it('serves the queue, its counts and the case read model', async () => {
    const me = await staff(['cases.view', 'cases.manage']);
    const row = await register('first');
    await register('second');
    const app = request(appFor(me.actor));

    const take = await app.post(`/v1/cases/${row.id}/take`);
    expect(take.status).toBe(200);
    const mine = await app.get('/v1/cases/queue?view=mine');
    expect((json(mine).items as Body[]).map((c) => c.title)).toEqual(['first']);
    const unassigned = await app.get('/v1/cases/queue?view=unassigned&type=KYB&limit=1');
    expect(unassigned.status).toBe(200);
    expect(json(unassigned).items).toHaveLength(1);
    expect(json(await app.get('/v1/cases/queue/counts'))).toMatchObject({ mine: 1, unassigned: 1 });

    const detail = json(await app.get(`/v1/cases/${row.id}`));
    expect(detail).toMatchObject({
      title: 'first',
      state: 'INVESTIGATING',
      evidenceRequests: [],
      decisions: [],
    });
    expect((detail.sla as Body).status).toBe('ON_TRACK');
    expect((await app.get('/v1/cases?q=not-a-case')).body).toMatchObject({ items: [] });
    expect((await app.get('/v1/cases/queue?view=nonsense')).status).toBe(422);
    expect((await app.get('/v1/cases/queue?cursor=garbage')).status).toBe(422);
    expect((await app.get('/v1/cases/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('demands a reason to reassign, escalate or re-prioritise, and a citation to decide', async () => {
    const me = await staff(['cases.view', 'cases.manage']);
    const row = await register('r');
    const app = request(appFor(me.actor));
    await app.post(`/v1/cases/${row.id}/take`);

    expect((await app.post(`/v1/cases/${row.id}/escalate`).send({})).status).toBe(400);
    expect((await app.post(`/v1/cases/${row.id}/priority`).send({ priority: 'HIGH' })).status).toBe(400);
    const header = await app
      .post(`/v1/cases/${row.id}/priority`)
      .set('X-Admin-Reason', 'Merchant is waiting')
      .send({ priority: 'HIGH' });
    expect(header.status).toBe(200);
    expect(
      (await app.post(`/v1/cases/${row.id}/decisions`).send({ outcome: 'APPROVE', reason: 'ok' })).status,
    ).toBe(422);
    expect(
      (await app.post(`/v1/cases/${row.id}/decisions`).send({ outcome: 'APPROVE', policyCitation: 'KYB §1' }))
        .status,
    ).toBe(400);
    expect(await count('cases.case_decisions')).toBe(0);

    const ok = await app
      .post(`/v1/cases/${row.id}/decisions`)
      .send({ outcome: 'APPROVE', reason: 'Documents verified', policyCitation: 'KYB Policy §1.2' });
    expect(ok.status).toBe(201);
    expect(json(ok).decision).toMatchObject({ outcome: 'APPROVE', policyCitation: 'KYB Policy §1.2' });
    expect(json(ok).case).toMatchObject({ state: 'DECIDED' });
    const trail = json(await app.get(`/v1/cases/${row.id}/trail?limit=1`));
    expect((trail.items as Body[])[0]).toMatchObject({
      type: 'DECISION_RECORDED',
      reason: 'Documents verified',
    });
    expect(trail.nextCursor).not.toBeNull();
  });

  it('answers 409 when a manager who does not own the case tries to decide it', async () => {
    const owner = await staff(['cases.view', 'cases.manage']);
    const other = await staff(['cases.view', 'cases.manage']);
    const row = await register('owned');
    await request(appFor(owner.actor)).post(`/v1/cases/${row.id}/take`);
    const res = await request(appFor(other.actor))
      .post(`/v1/cases/${row.id}/decisions`)
      .send({ outcome: 'APPROVE', reason: 'ok', policyCitation: 'KYB §1' });
    expect(res.status).toBe(409);
    expect(await count('cases.case_decisions')).toBe(0);
  });

  describe('the advisory', () => {
    it('suggests with a rationale, labelled, and writes nothing', async () => {
      const me = await staff(['cases.view']);
      const row = await register('adv', { documentsComplete: false });
      const app = request(appFor(me.actor));
      const before = await Promise.all(
        [
          'cases.cases',
          'cases.case_trail',
          'cases.case_decisions',
          'identity.identity_audit_log',
          'platform.outbox',
        ].map(count),
      );

      const res = await app.get(`/v1/cases/${row.id}/advisory`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        label: 'AI-suggested — not a decision',
        source: 'RULES_V1',
        suggestion: 'Request the missing business documents',
      });
      expect(json(res).rationale).toEqual(['The document set is incomplete']);

      const after = await Promise.all(
        [
          'cases.cases',
          'cases.case_trail',
          'cases.case_decisions',
          'identity.identity_audit_log',
          'platform.outbox',
        ].map(count),
      );
      expect(after).toEqual(before);
      const state = await t
        .owner()
        .query(`SELECT state, owner_user_id, updated_at FROM cases.cases WHERE id = $1`, [row.id]);
      expect(state.rows[0]).toMatchObject({ state: 'OPEN', owner_user_id: null });
    });

    it('cannot be posted back as a decision, and a viewer cannot decide on its strength', async () => {
      const viewer = await staff(['cases.view']);
      const manager = await staff(['cases.view', 'cases.manage']);
      const row = await register('adv2');
      const advisory = json(await request(appFor(viewer.actor)).get(`/v1/cases/${row.id}/advisory`));
      const app = request(appFor(manager.actor));
      await app.post(`/v1/cases/${row.id}/take`);

      // Handing the advisory to the decision route is a schema failure: the body takes no such member.
      const echoed = await app.post(`/v1/cases/${row.id}/decisions`).send({
        outcome: 'APPROVE',
        reason: 'The advisory said so',
        policyCitation: 'KYB §1',
        advisory,
      });
      expect(echoed.status).toBe(422);
      expect(
        (
          await request(appFor(viewer.actor)).post(`/v1/cases/${row.id}/decisions`).send({
            outcome: 'APPROVE',
            reason: 'x',
            policyCitation: 'KYB §1',
          })
        ).status,
      ).toBe(403);
      expect(await count('cases.case_decisions')).toBe(0);
    });
  });
});
