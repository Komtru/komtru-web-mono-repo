// T-055's routes through the platform's route mounting, against a real database: scopes, the two
// permissions, the reason rule, the policy citation, pagination, the 422 without the CAC documents, and
// that opening an application is gated on `merchant.application.view`.
import express from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../src/db/index.js';
import { createIdentityAuth } from '../../../src/modules/identity/index.js';
import { merchantRoutes } from '../../../src/modules/merchant/http/routes.js';
import { errorHandler, notFound } from '../../../src/platform/errors.js';
import { mountRoutes } from '../../../src/platform/http/mount.js';
import { actorFor, type Actor } from '../../../src/platform/http/principal.js';
import { assertRouteInvariants } from '../../../src/platform/http/route.js';
import { testPrincipal } from '../../support/actors.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { createTestRedis, redisReady, seedUser, testConfig, testLogger } from '../identity/support.js';
import { completeDraft, stubPorts, type StubPorts } from './support.js';

interface Body {
  [key: string]: unknown;
}
const json = (res: request.Response) => res.body as Body;

describe('the merchant routes declare what the platform requires', () => {
  it('passes assertRouteInvariants and gates every staff route on a merchant.application permission', () => {
    const routes = merchantRoutes({
      db: () => ({}) as Db,
      ports: () => stubPorts(),
      logger: () => testLogger,
    });
    expect(() => {
      assertRouteInvariants(routes);
    }).not.toThrow();
    for (const route of routes.filter((r) => r.path.startsWith('/admin/'))) {
      expect(route.scope).toBe('STAFF');
      expect(['merchant.application.view', 'merchant.application.decide']).toContain(route.permission);
      // Reads need view, and everything that changes something needs decide.
      expect(route.permission).toBe(
        route.method === 'get' ? 'merchant.application.view' : 'merchant.application.decide',
      );
    }
    for (const route of routes.filter((r) => r.path.startsWith('/merchant/')))
      expect(route.scope).toBe('CONSUMER');
    // The queue is the one collection, and it is paginated.
    expect(
      routes.find((r) => r.path === '/admin/merchant/applications' && r.method === 'get')?.paginated,
    ).toBe('page');
  });
});

describe.runIf(infraEnabled)('the merchant routes (T-055)', () => {
  const t = useTestDatabase();
  const db = (): Db => createDb(t.app());
  let redis: Redis;
  let ports: StubPorts;
  beforeAll(async () => {
    redis = createTestRedis();
    await redisReady(redis);
  });
  afterAll(async () => {
    await redis.quit();
  });

  const applicant = async () => {
    const { userId } = await seedUser(t.app());
    return { userId, actor: actorFor(testPrincipal(userId, { scope: 'CONSUMER' })) };
  };
  const staff = async (permissions: string[], roles: string[] = ['KYC_ANALYST']) => {
    const { userId } = await seedUser(t.app());
    return {
      userId,
      actor: actorFor(testPrincipal(userId, { scope: 'STAFF', roles, permissions: new Set(permissions) })),
    };
  };
  const appFor = (actor: Actor) => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    mountRoutes(merchantRoutes({ db, ports: () => ports, logger: () => testLogger }), {
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

  const VIEW = 'merchant.application.view';
  const DECIDE = 'merchant.application.decide';

  const submitAs = async (me: Awaited<ReturnType<typeof applicant>>, name = 'Techedge Nigeria Ltd') => {
    const draft = { ...completeDraft(ports, me.userId), businessName: name };
    const saved = json(await request(appFor(me.actor)).put('/v1/merchant/applications/me').send(draft));
    const submitted = await request(appFor(me.actor))
      .post(`/v1/merchant/applications/${String(saved.id)}/submit`)
      .send({});
    expect(submitted.status).toBe(200);
    return { id: String(saved.id), draft };
  };

  describe('the applicant', () => {
    it('reads null before starting, saves a draft, and reads it back', async () => {
      ports = stubPorts();
      const me = await applicant();
      const before = await request(appFor(me.actor)).get('/v1/merchant/applications/me');
      expect(before.status).toBe(200);
      expect(before.body).toBeNull();

      const saved = await request(appFor(me.actor))
        .put('/v1/merchant/applications/me')
        .send({ businessName: 'Techedge', businessType: 'REGISTERED_BUSINESS' });
      expect(saved.status).toBe(200);
      expect(json(saved)).toMatchObject({
        status: 'DRAFT',
        canEdit: true,
        form: { businessName: 'Techedge' },
      });
      expect(json(await request(appFor(me.actor)).get('/v1/merchant/applications/me'))).toMatchObject({
        id: json(saved).id,
      });
    });

    it('answers 422 on submit without the CAC documents, naming them', async () => {
      ports = stubPorts();
      const me = await applicant();
      const draft = completeDraft(ports, me.userId);
      const saved = json(
        await request(appFor(me.actor))
          .put('/v1/merchant/applications/me')
          .send({ ...draft, documents: [draft.documents[2]] }),
      );
      const res = await request(appFor(me.actor))
        .post(`/v1/merchant/applications/${String(saved.id)}/submit`)
        .send({});
      expect(res.status).toBe(422);
      expect(json(res)).toMatchObject({ code: 'VALIDATION_FAILED', title: 'The CAC documents are required' });
      expect(JSON.stringify(res.body)).toContain('documents.CAC_CERTIFICATE');
    });

    it('rejects a body with a member it does not know, and a malformed id', async () => {
      ports = stubPorts();
      const me = await applicant();
      expect(
        (await request(appFor(me.actor)).put('/v1/merchant/applications/me').send({ status: 'APPROVED' }))
          .status,
      ).toBe(422);
      expect(
        (await request(appFor(me.actor)).post('/v1/merchant/applications/nope/submit').send({})).status,
      ).toBe(422);
    });

    it('is closed to a staff session and to no session at all', async () => {
      ports = stubPorts();
      const person = await staff([VIEW, DECIDE]);
      expect((await request(appFor(person.actor)).get('/v1/merchant/applications/me')).status).toBe(403);
    });
  });

  describe('staff permissions', () => {
    it('gates reads on merchant.application.view and writes on merchant.application.decide', async () => {
      ports = stubPorts();
      const me = await applicant();
      const { id } = await submitAs(me);
      const none = await staff([]);
      const viewer = await staff([VIEW]);

      expect((await request(appFor(none.actor)).get('/v1/admin/merchant/applications')).status).toBe(403);
      expect((await request(appFor(none.actor)).get(`/v1/admin/merchant/applications/${id}`)).status).toBe(
        403,
      );
      expect((await request(appFor(none.actor)).get('/v1/admin/merchant/applications/count')).status).toBe(
        403,
      );
      expect((await request(appFor(viewer.actor)).get('/v1/admin/merchant/applications')).status).toBe(200);
      expect((await request(appFor(viewer.actor)).get(`/v1/admin/merchant/applications/${id}`)).status).toBe(
        200,
      );
      for (const action of ['assign', 'approve', 'reject', 'request-changes']) {
        const res = await request(appFor(viewer.actor))
          .post(`/v1/admin/merchant/applications/${id}/${action}`)
          .send({ reason: 'x', policyCitation: 'P', requested: [{ kind: 'FIELD', key: 'businessName' }] });
        expect(res.status, action).toBe(403);
      }
      // A consumer session holding the permission string is still refused: scope first.
      const consumer = actorFor(
        testPrincipal(me.userId, { scope: 'CONSUMER', permissions: new Set([VIEW, DECIDE]) }),
      );
      expect((await request(appFor(consumer)).get('/v1/admin/merchant/applications')).status).toBe(403);
    });
  });

  describe('the queue and the count', () => {
    it('pages the queue, filters it, and counts what awaits review', async () => {
      ports = stubPorts();
      const viewer = await staff([VIEW]);
      for (const name of ['A Ltd', 'B Ltd', 'C Ltd']) await submitAs(await applicant(), name);
      const app = request(appFor(viewer.actor));

      const page = await app.get('/v1/admin/merchant/applications?limit=2');
      expect(page.status).toBe(200);
      expect(json(page)).toMatchObject({ page: 1, limit: 2, total: 3 });
      expect(json(page).items).toHaveLength(2);
      expect(
        (json(await app.get('/v1/admin/merchant/applications?limit=2&page=2')).items as Body[]).length,
      ).toBe(1);
      expect(
        (json(await app.get('/v1/admin/merchant/applications?category=LAPTOPS')).items as Body[]).length,
      ).toBe(0);
      expect(
        (json(await app.get('/v1/admin/merchant/applications?category=PHONES')).items as Body[]).length,
      ).toBe(3);
      expect(json(await app.get('/v1/admin/merchant/applications/count'))).toEqual({ awaitingReview: 3 });
      expect((await app.get('/v1/admin/merchant/applications?status=NONSENSE')).status).toBe(422);
      expect(
        (await app.get('/v1/admin/merchant/applications/00000000-0000-4000-8000-000000000000')).status,
      ).toBe(404);
    });
  });

  describe('opening an application', () => {
    it('serves the evidence, the advisory and signed documents, each logged for this reviewer', async () => {
      ports = stubPorts();
      const me = await applicant();
      const { id } = await submitAs(me);
      const viewer = await staff([VIEW], ['KYC_ANALYST']);
      const res = await request(appFor(viewer.actor)).get(`/v1/admin/merchant/applications/${id}`);
      expect(res.status).toBe(200);
      const detail = json(res);
      expect(detail).toMatchObject({
        applicationId: id,
        evidence: { documents: { complete: true }, bankNameMatch: { state: 'EXACT' } },
        advisory: { label: 'AI-suggested — not a decision' },
        form: { businessName: 'Techedge Nigeria Ltd' },
      });
      expect((detail.documents as Body[]).map((d) => d.docType)).toEqual([
        'CAC_CERTIFICATE',
        'STATUS_REPORT',
        'DIRECTOR_ID',
      ]);
      expect((detail.documents as Body[]).every((d) => typeof d.url === 'string')).toBe(true);
      expect(ports.signed.map((s) => s.viewer.userId)).toEqual(Array(3).fill(viewer.userId));
      expect(ports.signed.map((s) => s.viewer.roles)).toEqual(Array(3).fill(['KYC_ANALYST']));
    });
  });

  describe('decisions', () => {
    const taken = async () => {
      ports = stubPorts();
      const me = await applicant();
      const { id } = await submitAs(me);
      const decider = await staff([VIEW, DECIDE]);
      const take = await request(appFor(decider.actor))
        .post(`/v1/admin/merchant/applications/${id}/assign`)
        .send({});
      expect(take.status).toBe(200);
      expect(json(take)).toMatchObject({ status: 'IN_REVIEW', ownerUserId: decider.userId });
      return { me, id, decider };
    };

    it('requires a reason (400) and a policy citation (422) on every decision', async () => {
      const { id, decider } = await taken();
      const app = request(appFor(decider.actor));
      const requested = [{ kind: 'DOCUMENT', key: 'CAC_CERTIFICATE' }];
      for (const [action, extra] of [
        ['approve', {}],
        ['reject', {}],
        ['request-changes', { requested }],
      ] as const) {
        const noReason = await app
          .post(`/v1/admin/merchant/applications/${id}/${action}`)
          .send({ policyCitation: 'MER-1', ...extra });
        expect(noReason.status, `${action} without a reason`).toBe(400);
        const noCitation = await app
          .post(`/v1/admin/merchant/applications/${id}/${action}`)
          .send({ reason: 'Because', ...extra });
        expect(noCitation.status, `${action} without a citation`).toBe(422);
        const blankCitation = await app
          .post(`/v1/admin/merchant/applications/${id}/${action}`)
          .send({ reason: 'Because', policyCitation: '   ', ...extra });
        expect(blankCitation.status, `${action} with a blank citation`).toBe(422);
      }
      expect((await t.owner().query(`SELECT status FROM merchant.merchant_applications`)).rows).toEqual([
        { status: 'IN_REVIEW' },
      ]);
      expect((await t.owner().query(`SELECT count(*)::int AS n FROM cases.case_decisions`)).rows[0]).toEqual({
        n: 0,
      });
    });

    it('reads the reason from X-Admin-Reason when the body has none', async () => {
      const { id, decider } = await taken();
      const res = await request(appFor(decider.actor))
        .post(`/v1/admin/merchant/applications/${id}/reject`)
        .set('X-Admin-Reason', 'Documents do not match the CAC record')
        .send({ policyCitation: 'MER-POL-3.2' });
      expect(res.status).toBe(200);
      expect(json(res)).toMatchObject({ applicationId: id, status: 'REJECTED' });
    });

    it('approves: certification, with the storefront slug in the answer and the admin log written', async () => {
      const { id, decider, me } = await taken();
      const res = await request(appFor(decider.actor))
        .post(`/v1/admin/merchant/applications/${id}/approve`)
        .send({ reason: 'Documents verified', policyCitation: 'MER-POL-2.1' });
      expect(res.status).toBe(200);
      expect(json(res)).toEqual({
        applicationId: id,
        status: 'APPROVED',
        storefrontSlug: 'techedge-nigeria-ltd',
      });
      expect(
        (
          await t
            .owner()
            .query(`SELECT status FROM identity.user_capabilities WHERE user_id = $1`, [me.userId])
        ).rows,
      ).toEqual([{ status: 'ACTIVE' }]);
      const audit = await t
        .owner()
        .query<{ actor_user_id: string; metadata: Record<string, unknown> }>(
          `SELECT actor_user_id, metadata FROM identity.identity_audit_log WHERE action = 'ADMIN_CASE_DECIDED'`,
        );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]?.actor_user_id).toBe(decider.userId);
      expect(audit.rows[0]?.metadata).toMatchObject({
        reason: 'Documents verified',
        policyCitation: 'MER-POL-2.1',
      });
    });

    it('requests changes naming documents or fields, and refuses an empty or unknown list', async () => {
      const { id, decider } = await taken();
      const app = request(appFor(decider.actor));
      const empty = await app
        .post(`/v1/admin/merchant/applications/${id}/request-changes`)
        .send({ reason: 'Fix it', policyCitation: 'MER-1', requested: [] });
      expect(empty.status).toBe(422);
      const unknown = await app.post(`/v1/admin/merchant/applications/${id}/request-changes`).send({
        reason: 'Fix it',
        policyCitation: 'MER-1',
        requested: [{ kind: 'DOCUMENT', key: 'PASSPORT' }],
      });
      expect(unknown.status).toBe(422);
      const ok = await app.post(`/v1/admin/merchant/applications/${id}/request-changes`).send({
        reason: 'The scan is cut off',
        policyCitation: 'MER-1',
        requested: [{ kind: 'DOCUMENT', key: 'CAC_CERTIFICATE', note: 'Whole page please' }],
      });
      expect(ok.status).toBe(200);
      expect(json(ok)).toEqual({ applicationId: id, status: 'CHANGES_REQUESTED' });
    });

    it('is refused for someone who has not taken the case, and once it has been decided', async () => {
      ports = stubPorts();
      const me = await applicant();
      const { id } = await submitAs(me);
      const decider = await staff([VIEW, DECIDE]);
      const body = { reason: 'No', policyCitation: 'MER-1' };
      expect(
        (await request(appFor(decider.actor)).post(`/v1/admin/merchant/applications/${id}/reject`).send(body))
          .status,
      ).toBe(409);
      await request(appFor(decider.actor)).post(`/v1/admin/merchant/applications/${id}/assign`).send({});
      expect(
        (await request(appFor(decider.actor)).post(`/v1/admin/merchant/applications/${id}/reject`).send(body))
          .status,
      ).toBe(200);
      expect(
        (
          await request(appFor(decider.actor))
            .post(`/v1/admin/merchant/applications/${id}/approve`)
            .send(body)
        ).status,
      ).toBe(409);
    });
  });
});
