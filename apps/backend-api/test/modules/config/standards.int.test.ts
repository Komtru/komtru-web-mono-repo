// T-049 against a real database: the seed, versioning, the public reads, the buyer-window rule and the
// admin write path (audit row, outbox event). Skipped unless KOMTRU_INFRA_TESTS=1.
import express from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../src/db/index.js';
import { SEED_CATEGORIES } from '../../../src/modules/config/domain/standards.js';
import {
  standardsAdminRoutes,
  standardsPublicRoutes,
} from '../../../src/modules/config/http/standards.routes.js';
import { createConfigAccessor } from '../../../src/modules/config/services/accessor.js';
import { seedSettings } from '../../../src/modules/config/services/settings.service.js';
import {
  checkBuyerWindowChange,
  getCurrentStandard,
  getStandardVersion,
  seedStandards,
} from '../../../src/modules/config/services/standards.service.js';
import { errorHandler, notFound } from '../../../src/platform/errors.js';
import { mountRoutes } from '../../../src/platform/http/mount.js';
import { ANONYMOUS_ACTOR, actorFor, type Actor } from '../../../src/platform/http/principal.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { testPrincipal } from '../../support/actors.js';
import { createIdentityAuth } from '../../../src/modules/identity/index.js';
import {
  createTestRedis,
  testConfig,
  outboxEventTypes,
  redisReady,
  seedUser,
  testLogger,
} from '../identity/support.js';

interface Body {
  versionId: string;
  versionNumber: number;
  items: { categoryCode: string; reason?: string }[];
}
const json = (res: request.Response) => res.body as Body;

const REASON = 'ticket 5120: laptops need a longer inspection window';

describe.runIf(infraEnabled)('trade standards (T-049)', () => {
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
  beforeEach(async () => {
    await seedSettings(db());
    await seedStandards(db());
    await accessor().purgeSetting('trades', 'inspection_window_max_extension_hours');
  });

  const accessor = () => createConfigAccessor(db(), redis, testLogger);

  const staffActor = async (permissions: string[]): Promise<Actor> => {
    const { userId } = await seedUser(t.app());
    return actorFor(testPrincipal(userId, { scope: 'STAFF', permissions: new Set(permissions) }));
  };

  const appFor = (actor: Actor) => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    const deps = { db, accessor };
    mountRoutes([...standardsPublicRoutes(deps), ...standardsAdminRoutes(deps)], {
      logger: testLogger,
      onDenied: createIdentityAuth({ db: db(), redis, config: testConfig(), logger: testLogger })
        .onAccessDenied,
      resolveActor: () => Promise.resolve(actor),
      rateLimit: () => Promise.resolve(),
    })(router);
    app.use('/v1', router);
    app.use(notFound);
    app.use(errorHandler(testLogger, () => undefined));
    return app;
  };
  const anon = ANONYMOUS_ACTOR;

  const electronicsBody = async () => {
    const current = await getCurrentStandard(db(), 'electronics');
    return {
      inspectionWindowHours: current.inspectionWindowHours,
      itemSpecFields: current.itemSpecFields,
      proofMedia: current.proofMedia,
      imeiVerification: current.imeiVerification,
      deliveryDeadlineDays: current.deliveryDeadlineDays,
    };
  };

  describe('seed', () => {
    it('creates Electronics and Fashion at version 1, and a second run changes nothing', async () => {
      await seedStandards(db());
      const { rows } = await t.owner().query(
        `SELECT c.code, count(*)::int AS versions FROM config.trade_standards s
           JOIN config.trade_categories c ON c.id = s.category_id GROUP BY c.code ORDER BY c.code`,
      );
      expect(rows).toEqual([
        { code: 'electronics', versions: 1 },
        { code: 'fashion', versions: 1 },
      ]);
      const e = await getCurrentStandard(db(), 'electronics');
      expect(e.versionNumber).toBe(1);
      expect(e.inspectionWindowHours).toBe(SEED_CATEGORIES[0]?.standard.inspectionWindowHours);
    });

    it('does not overwrite an operator change on the next seed', async () => {
      const admin = await staffActor(['config.manage']);
      const body = { ...(await electronicsBody()), inspectionWindowHours: 96 };
      await request(appFor(admin))
        .put('/v1/admin/config/trade-standards/electronics')
        .send({ ...body, reason: REASON })
        .expect(200);
      await seedStandards(db());
      expect((await getCurrentStandard(db(), 'electronics')).inspectionWindowHours).toBe(96);
    });
  });

  describe('versioning', () => {
    it('a change creates version 2 while version 1 stays readable by id, unchanged', async () => {
      const v1 = await getCurrentStandard(db(), 'electronics');
      const admin = await staffActor(['config.manage']);
      const res = await request(appFor(admin))
        .put('/v1/admin/config/trade-standards/electronics')
        .send({ ...(await electronicsBody()), inspectionWindowHours: 96, reason: REASON })
        .expect(200);
      expect(json(res).versionNumber).toBe(2);
      expect(json(res).versionId).not.toBe(v1.versionId);

      const snapshot = await getStandardVersion(db(), v1.versionId);
      expect(snapshot.inspectionWindowHours).toBe(v1.inspectionWindowHours);
      expect(snapshot.versionNumber).toBe(1);
      expect((await getCurrentStandard(db(), 'electronics')).versionId).toBe(json(res).versionId);
    });

    it('writes an audit row and an outbox event, and none for an identical standard', async () => {
      const admin = await staffActor(['config.manage']);
      const app = appFor(admin);
      const same = { ...(await electronicsBody()), reason: REASON };
      await request(app).put('/v1/admin/config/trade-standards/electronics').send(same).expect(200);
      expect(await outboxEventTypes(t.app())).toEqual([]);

      await request(app)
        .put('/v1/admin/config/trade-standards/electronics')
        .send({ ...same, deliveryDeadlineDays: 10 })
        .expect(200);
      expect(await outboxEventTypes(t.app())).toEqual(['config.trade_standard.changed']);
      const { rows } = await t
        .owner()
        .query<{ metadata: unknown }>(
          `SELECT actor_user_id, metadata FROM identity.identity_audit_log WHERE action = 'ADMIN_CONFIG_TRADE_STANDARD_CHANGED'`,
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.metadata).toMatchObject({
        categoryCode: 'electronics',
        versionNumber: 2,
        reason: REASON,
      });
    });

    it('two simultaneous changes become versions 2 and 3, never two version 2s', async () => {
      const admin = await staffActor(['config.manage']);
      const app = appFor(admin);
      const base = await electronicsBody();
      const results = await Promise.all(
        [60, 72].map((h) =>
          request(app)
            .put('/v1/admin/config/trade-standards/electronics')
            .send({ ...base, inspectionWindowHours: h, reason: REASON }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(results.map((r) => json(r).versionNumber).sort()).toEqual([2, 3]);
    });

    it('refuses an UPDATE or DELETE of a version, even for the owner', async () => {
      await expect(t.owner().query(`UPDATE config.trade_standards SET reason = 'x'`)).rejects.toThrow();
      await expect(t.owner().query(`DELETE FROM config.trade_standards`)).rejects.toThrow();
    });
  });

  describe('admin write guards', () => {
    it('requires config.manage, a reason, and refuses a fee member', async () => {
      const viewer = await staffActor(['config.view']);
      const body = await electronicsBody();
      await request(appFor(viewer))
        .put('/v1/admin/config/trade-standards/electronics')
        .send({ ...body, reason: REASON })
        .expect(403);

      const admin = await staffActor(['config.manage']);
      await request(appFor(admin)).put('/v1/admin/config/trade-standards/electronics').send(body).expect(400);
      await request(appFor(admin))
        .put('/v1/admin/config/trade-standards/electronics')
        .send({ ...body, sellerCommissionBps: 1, reason: REASON })
        .expect(422);
      await request(appFor(admin))
        .put('/v1/admin/config/trade-standards/nope')
        .send({ ...body, reason: REASON })
        .expect(404);
    });

    it('audits a refused write (config.view only, and a non-staff caller) and creates no version', async () => {
      const body = { ...(await electronicsBody()), inspectionWindowHours: 96, reason: REASON };
      const viewer = await staffActor(['config.view']);
      await request(appFor(viewer))
        .put('/v1/admin/config/trade-standards/electronics')
        .send(body)
        .expect(403);
      const { userId } = await seedUser(t.app());
      const consumer = actorFor(
        testPrincipal(userId, { scope: 'CONSUMER', permissions: new Set(['config.manage']) }),
      );
      await request(appFor(consumer))
        .put('/v1/admin/config/trade-standards/electronics')
        .send(body)
        .expect(403);

      const { rows } = await t
        .app()
        .query<{ actor_user_id: string; outcome: string; metadata: Record<string, unknown> }>(
          `SELECT actor_user_id, outcome, metadata FROM identity.identity_audit_log
            WHERE action = 'ADMIN_ACTION_DENIED' ORDER BY id`,
        );
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        actor_user_id: (viewer.principal as { userId: string }).userId,
        outcome: 'DENIED',
        metadata: {
          route: 'PUT /admin/config/trade-standards/:categoryCode',
          permission: 'config.manage',
          denied: 'ROUTE_PERMISSION',
          reason: REASON,
        },
      });
      expect(rows[1]).toMatchObject({
        actor_user_id: userId,
        metadata: { permission: 'config.manage', denied: 'ROUTE_SCOPE' },
      });
      expect((await getCurrentStandard(db(), 'electronics')).versionNumber).toBe(1);
    });

    it('rolls the version back when the audit insert fails', async () => {
      const admin = await staffActor(['config.manage']);
      await t
        .owner()
        .query(
          `CREATE OR REPLACE FUNCTION config.t049_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced audit failure'; END $$`,
        );
      await t
        .owner()
        .query(
          `CREATE TRIGGER t049_fail BEFORE INSERT ON identity.identity_audit_log FOR EACH ROW WHEN (NEW.action = 'ADMIN_CONFIG_TRADE_STANDARD_CHANGED') EXECUTE FUNCTION config.t049_fail()`,
        );
      try {
        const res = await request(appFor(admin))
          .put('/v1/admin/config/trade-standards/electronics')
          .send({ ...(await electronicsBody()), inspectionWindowHours: 96, reason: REASON });
        expect(res.status).toBeGreaterThanOrEqual(500);
      } finally {
        await t.owner().query(`DROP TRIGGER t049_fail ON identity.identity_audit_log`);
        await t.owner().query(`DROP FUNCTION config.t049_fail()`);
      }
      const { rows } = await t
        .owner()
        .query<{ n: number }>(
          `SELECT count(*)::int AS n FROM config.trade_standards s JOIN config.trade_categories c ON c.id = s.category_id WHERE c.code = 'electronics'`,
        );
      expect(rows[0]?.n).toBe(1);
      expect(await outboxEventTypes(t.app())).toEqual([]);
    });

    it('lists the standards for config.view', async () => {
      const viewer = await staffActor(['config.view']);
      const res = await request(appFor(viewer)).get('/v1/admin/config/trade-standards').expect(200);
      expect(json(res).items.map((i: { categoryCode: string }) => i.categoryCode)).toEqual([
        'electronics',
        'fashion',
      ]);
      expect(json(res).items[0]?.reason).toBeTypeOf('string');
    });
  });

  describe('public reads (CTS1 and trade creation)', () => {
    it('lists, reads by category and by version id with no session, and carries no author or reason', async () => {
      const app = appFor(anon);
      const list = await request(app).get('/v1/config/trade-standards').expect(200);
      expect(json(list).items.map((i: { categoryCode: string }) => i.categoryCode)).toEqual([
        'electronics',
        'fashion',
      ]);

      const one = await request(app).get('/v1/config/trade-standards/electronics').expect(200);
      expect(json(one)).toMatchObject({
        categoryCode: 'electronics',
        versionNumber: 1,
        imeiVerification: true,
      });
      expect(json(one)).not.toHaveProperty('reason');
      expect(json(one)).not.toHaveProperty('changedByAdminId');

      const byId = await request(app)
        .get(`/v1/config/trade-standards/versions/${json(one).versionId}`)
        .expect(200);
      expect(json(byId)).toEqual(json(one));
    });

    it('404s an unknown category and an unknown version, and never lets an error be cached', async () => {
      const app = appFor(anon);
      const a = await request(app).get('/v1/config/trade-standards/furniture').expect(404);
      expect(a.headers['cache-control']).toBe('no-store');
      const b = await request(app)
        .get('/v1/config/trade-standards/versions/7f3c1c5e-0000-4000-8000-000000000000')
        .expect(404);
      expect(b.headers['cache-control']).toBe('no-store');
    });

    it('serves current reads as no-cache with an ETag on the version id, and answers 304 to a match', async () => {
      const app = appFor(anon);
      const one = await request(app).get('/v1/config/trade-standards/electronics').expect(200);
      expect(one.headers['cache-control']).toBe('no-cache');
      const etag = one.headers.etag ?? '';
      expect(etag).toContain(json(one).versionId);
      await request(app).get('/v1/config/trade-standards/electronics').set('If-None-Match', etag).expect(304);

      const list = await request(app).get('/v1/config/trade-standards').expect(200);
      expect(list.headers['cache-control']).toBe('no-cache');
      const listTag = list.headers.etag ?? '';
      await request(app).get('/v1/config/trade-standards').set('If-None-Match', listTag).expect(304);

      const admin = await staffActor(['config.manage']);
      await request(appFor(admin))
        .put('/v1/admin/config/trade-standards/electronics')
        .send({ ...(await electronicsBody()), inspectionWindowHours: 96, reason: REASON })
        .expect(200);
      const after = await request(app)
        .get('/v1/config/trade-standards/electronics')
        .set('If-None-Match', etag)
        .expect(200);
      expect(json(after).versionNumber).toBe(2);
      await request(app).get('/v1/config/trade-standards').set('If-None-Match', listTag).expect(200);
    });

    it('keeps a version by id immutable-cacheable', async () => {
      const app = appFor(anon);
      const one = await request(app).get('/v1/config/trade-standards/electronics').expect(200);
      const byId = await request(app)
        .get(`/v1/config/trade-standards/versions/${json(one).versionId}`)
        .expect(200);
      expect(byId.headers['cache-control']).toContain('immutable');
    });
  });

  describe('buyer window change (BEI1)', () => {
    const change = async (requestedHours: number, currentHours = 48) => {
      const std = await getCurrentStandard(db(), 'electronics');
      return checkBuyerWindowChange(db(), accessor(), {
        standardVersionId: std.versionId,
        currentHours,
        requestedHours,
      });
    };

    it('allows a longer window up to the configured cap', async () => {
      expect(await change(72)).toBe(72);
      expect(await change(96)).toBe(96); // standard 48 + cap 48
    });

    it('refuses a shorter or equal window, and one above the cap', async () => {
      await expect(change(24)).rejects.toMatchObject({ status: 422 });
      await expect(change(48)).rejects.toMatchObject({ status: 422 });
      await expect(change(97)).rejects.toMatchObject({ status: 422 });
    });

    it('follows the setting: lowering the cap tightens what is allowed', async () => {
      await t
        .owner()
        .query(
          `UPDATE config.platform_settings SET value = '12'::jsonb WHERE namespace = 'trades' AND key = 'inspection_window_max_extension_hours'`,
        );
      await accessor().purgeSetting('trades', 'inspection_window_max_extension_hours');
      await expect(change(72)).rejects.toMatchObject({ status: 422 });
      expect(await change(60)).toBe(60);
    });

    it('measures against the version the trade snapshotted, not the current one', async () => {
      const v1 = await getCurrentStandard(db(), 'electronics');
      const admin = await staffActor(['config.manage']);
      await request(appFor(admin))
        .put('/v1/admin/config/trade-standards/electronics')
        .send({ ...(await electronicsBody()), inspectionWindowHours: 96, reason: REASON })
        .expect(200);
      const hours = await checkBuyerWindowChange(db(), accessor(), {
        standardVersionId: v1.versionId,
        currentHours: 48,
        requestedHours: 90,
      });
      expect(hours).toBe(90);
    });
  });
});
