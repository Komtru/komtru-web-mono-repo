// M17 against a real database and Redis: the seed, the typed accessor and its cache, the admin routes
// through mountRoutes (so the scope and permission checks are the platform's own), the change log, the
// admin action row and the outbox event. Skipped unless KOMTRU_INFRA_TESTS=1.
import express from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../src/db/index.js';
import { SEED_SETTINGS, looksLikeFee } from '../../../src/modules/config/index.js';
import { createConfigAccessor } from '../../../src/modules/config/services/accessor.js';
import { configAdminRoutes } from '../../../src/modules/config/http/admin.routes.js';
import { seedSettings } from '../../../src/modules/config/services/settings.service.js';
import { errorHandler, notFound } from '../../../src/platform/errors.js';
import { mountRoutes } from '../../../src/platform/http/mount.js';
import { actorFor, type Actor } from '../../../src/platform/http/principal.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { testPrincipal } from '../../support/actors.js';
import { createTestRedis, outboxEventTypes, redisReady, seedUser, testLogger } from '../identity/support.js';

const countOf = async (pool: { query: (q: string) => Promise<{ rows: { n: number }[] }> }, table: string) =>
  (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]?.n;

const REASON = 'ticket 4471: support asked for a longer window';

describe.runIf(infraEnabled)('config (M17)', () => {
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
    const keys = await redis.keys('config:*');
    // keys() returns the prefixed names; del() re-prefixes, so strip it.
    for (const key of keys) await redis.del(key.replace(/^.*?(config:)/, '$1'));
  });

  const accessor = (ttl?: number) => createConfigAccessor(db(), redis, testLogger, ttl);

  const staffActor = async (permissions: string[]): Promise<Actor> => {
    const { userId } = await seedUser(t.app());
    return actorFor(testPrincipal(userId, { scope: 'STAFF', permissions: new Set(permissions) }));
  };

  const appFor = (actor: Actor) => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    mountRoutes(configAdminRoutes({ db, accessor: () => accessor() }), {
      logger: testLogger,
      resolveActor: () => Promise.resolve(actor),
      rateLimit: () => Promise.resolve(),
    })(router);
    app.use('/v1', router);
    app.use(notFound);
    app.use(errorHandler(testLogger, () => undefined));
    return app;
  };

  describe('seed', () => {
    it('writes every seeded default, once, and never overwrites an edit', async () => {
      expect(await countOf(t.app(), 'config.platform_settings')).toBe(SEED_SETTINGS.length);

      await t
        .owner()
        .query(
          `UPDATE config.platform_settings SET value = '9' WHERE namespace = 'disputes' AND key = 'evidence_window_days'`,
        );
      await seedSettings(db());
      const after = await t
        .app()
        .query<{ value: unknown }>(
          `SELECT value FROM config.platform_settings WHERE namespace = 'disputes' AND key = 'evidence_window_days'`,
        );
      expect(after.rows[0]?.value).toBe(9);
      expect(await countOf(t.app(), 'config.platform_settings')).toBe(SEED_SETTINGS.length);
    });

    it('holds no key that looks like a fee', async () => {
      const { rows } = await t
        .app()
        .query<{ namespace: string; key: string }>('SELECT namespace, key FROM config.platform_settings');
      expect(rows.length).toBeGreaterThan(0);
      const offenders = rows.filter((row) => looksLikeFee(row.namespace, row.key));
      expect(offenders).toEqual([]);
    });
  });

  describe('accessor', () => {
    it('reads typed values and fills the cache', async () => {
      const settings = accessor();
      expect(await settings.getInteger('park', 'pin_max_attempts')).toBe(3);
      expect(await redis.get('config:setting:park.pin_max_attempts')).not.toBeNull();
      // The second read is served from Redis: the row can be gone and the value still comes back.
      await t
        .owner()
        .query(`DELETE FROM config.platform_settings WHERE namespace = 'park' AND key = 'pin_max_attempts'`);
      expect(await settings.getInteger('park', 'pin_max_attempts')).toBe(3);
    });

    it('refuses a read as the wrong type and a setting that is not there', async () => {
      const settings = accessor();
      await expect(settings.getBoolean('park', 'pin_max_attempts')).rejects.toThrow(/read as BOOLEAN/);
      await expect(settings.getInteger('park', 'nope')).rejects.toThrow(/not in platform_settings/);
    });

    it('treats an unknown flag as off', async () => {
      expect(await accessor().isEnabled('never.heard_of_it')).toBe(false);
    });

    it('is invalidated by a change made through the admin route', async () => {
      const settings = accessor();
      expect(await settings.getInteger('disputes', 'evidence_window_days')).toBe(5);
      const admin = await staffActor(['config.manage']);
      await request(appFor(admin))
        .put('/v1/admin/config/settings/disputes/evidence_window_days')
        .send({ value: 6, reason: REASON })
        .expect(200);
      expect(await settings.getInteger('disputes', 'evidence_window_days')).toBe(6);
    });

    it('invalidates on the event too, for a change another instance made', async () => {
      const settings = accessor();
      expect(await settings.getInteger('tickets', 'reopen_window_days')).toBe(14);
      await t
        .owner()
        .query(
          `UPDATE config.platform_settings SET value = '3' WHERE namespace = 'tickets' AND key = 'reopen_window_days'`,
        );
      // Still the cached value until the subscriber runs.
      expect(await settings.getInteger('tickets', 'reopen_window_days')).toBe(14);
      await settings.invalidateSetting('tickets', 'reopen_window_days');
      expect(await settings.getInteger('tickets', 'reopen_window_days')).toBe(3);
    });
  });

  describe('admin routes', () => {
    const put = (
      app: express.Express,
      body: Record<string, unknown>,
      path = '/v1/admin/config/settings/disputes/appeal_window_days',
    ) => request(app).put(path).send(body);

    it('lists a namespace for config.view and refuses without it', async () => {
      const viewer = await staffActor(['config.view']);
      const res = await request(appFor(viewer)).get('/v1/admin/config/settings/disputes').expect(200);
      const body = res.body as { items: { key: string; value: unknown }[]; total: number };
      expect(body.total).toBe(3);
      expect(body.items.map((i) => i.key)).toEqual([
        'appeal_window_days',
        'evidence_window_days',
        'mediation_window_hours',
      ]);

      const nobody = await staffActor([]);
      await request(appFor(nobody)).get('/v1/admin/config/settings/disputes').expect(403);
    });

    it('refuses a write with config.view only, and a non-staff session', async () => {
      const viewer = await staffActor(['config.view']);
      await put(appFor(viewer), { value: 8, reason: REASON }).expect(403);

      const { userId } = await seedUser(t.app());
      const consumer = actorFor(
        testPrincipal(userId, { scope: 'CONSUMER', permissions: new Set(['config.manage']) }),
      );
      await put(appFor(consumer), { value: 8, reason: REASON }).expect(403);
    });

    it('requires a reason, from the body, the header, and never blank', async () => {
      const admin = await staffActor(['config.manage']);
      const app = appFor(admin);
      await put(app, { value: 8 }).expect(400);
      await put(app, { value: 8, reason: '   ' }).expect(400);
      await put(app, { value: 8, reason: 'x'.repeat(1001) }).expect(422);
      await request(app)
        .put('/v1/admin/config/settings/disputes/appeal_window_days')
        .set('X-Admin-Reason', REASON)
        .send({ value: 8 })
        .expect(200);
      expect(await countOf(t.app(), 'config.config_change_log')).toBe(1);
    });

    it('writes the row, the change log, the admin action row and the event in one go', async () => {
      const admin = await staffActor(['config.manage']);
      const res = await put(appFor(admin), { value: 1, reason: REASON }).expect(200);
      expect(res.body).toMatchObject({ namespace: 'disputes', key: 'appeal_window_days', value: 1 });

      const log = await t.app().query(
        `SELECT change_target, namespace_or_flag_code, key, old_value, new_value, changed_by_admin_id, reason
           FROM config.config_change_log`,
      );
      expect(log.rows).toEqual([
        {
          change_target: 'SETTING',
          namespace_or_flag_code: 'disputes',
          key: 'appeal_window_days',
          old_value: 7,
          new_value: 1,
          changed_by_admin_id: (admin.principal as { userId: string }).userId,
          reason: REASON,
        },
      ]);

      const audit = await t
        .app()
        .query<{ action: string; actor_type: string; metadata: unknown }>(
          `SELECT action, actor_type, metadata FROM identity.identity_audit_log WHERE action = 'ADMIN_CONFIG_SETTING_CHANGED'`,
        );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]?.actor_type).toBe('STAFF');
      expect(audit.rows[0]?.metadata).toMatchObject({
        namespace: 'disputes',
        key: 'appeal_window_days',
        oldValue: 7,
        newValue: 1,
        reason: REASON,
      });

      expect(await outboxEventTypes(t.app())).toEqual(['config.setting.changed']);
    });

    it('logs nothing and publishes nothing when the value is unchanged', async () => {
      const admin = await staffActor(['config.manage']);
      await put(appFor(admin), { value: 7, reason: REASON }).expect(200);
      expect(await countOf(t.app(), 'config.config_change_log')).toBe(0);
      expect(await outboxEventTypes(t.app())).toEqual([]);
    });

    it('validates the value against the stored type and the seeded bounds', async () => {
      const admin = await staffActor(['config.manage']);
      const app = appFor(admin);
      await put(app, { value: 'seven', reason: REASON }).expect(422);
      await put(app, { value: 7.5, reason: REASON }).expect(422);
      await put(app, { value: 0, reason: REASON }).expect(422);
      await put(app, { value: 100000, reason: REASON }).expect(422);
      await put(app, { value: 7, reason: REASON, extra: true }).expect(422);
    });

    it('answers 404 for a setting that is not seeded, and refuses a fee-like key', async () => {
      const admin = await staffActor(['config.manage']);
      const app = appFor(admin);
      await put(app, { value: 1, reason: REASON }, '/v1/admin/config/settings/disputes/no_such_key').expect(
        404,
      );
      await put(
        app,
        { value: 1, reason: REASON },
        '/v1/admin/config/settings/trades/buyer_protection_fee_bps',
      ).expect(400);
      await put(
        app,
        { enabled: true, description: 'A boost', reason: REASON },
        '/v1/admin/config/flags/seller_commission_boost',
      ).expect(400);
    });

    it('creates and toggles a flag, with a reason, and logs both', async () => {
      const admin = await staffActor(['config.manage']);
      const app = appFor(admin);
      const code = '/v1/admin/config/flags/logistics.partner_companies_visible';

      // A new flag needs a description.
      await request(app).put(code).send({ enabled: false, reason: REASON }).expect(422);
      await request(app)
        .put(code)
        .send({ enabled: false, description: 'Shows partner companies', reason: REASON })
        .expect(200);
      await request(app)
        .put(code)
        .send({ enabled: true, rolloutNote: 'first partner onboarded' })
        .expect(400);
      const on = await request(app)
        .put(code)
        .send({ enabled: true, rolloutNote: 'first partner onboarded', reason: REASON })
        .expect(200);
      expect(on.body).toMatchObject({ enabled: true, rolloutNote: 'first partner onboarded' });

      expect(await accessor().isEnabled('logistics.partner_companies_visible')).toBe(true);

      const viewer = await staffActor(['config.view']);
      const flags = await request(appFor(viewer)).get('/v1/admin/config/flags').expect(200);
      expect((flags.body as { items: unknown[] }).items).toHaveLength(1);

      const events = await outboxEventTypes(t.app());
      expect(events).toEqual(['config.feature_flag.toggled', 'config.feature_flag.toggled']);
    });

    it('reads the change log newest first, filtered', async () => {
      const admin = await staffActor(['config.manage', 'config.view']);
      const app = appFor(admin);
      await put(app, { value: 2, reason: 'first' }).expect(200);
      await put(app, { value: 3, reason: 'second' }).expect(200);
      await request(app)
        .put('/v1/admin/config/flags/some.flag')
        .send({ enabled: true, description: 'Some flag', reason: 'third' })
        .expect(200);

      const all = await request(app).get('/v1/admin/config/change-log').expect(200);
      const items = (all.body as { items: { reason: string }[] }).items;
      expect(items.map((i) => i.reason)).toEqual(['third', 'second', 'first']);

      const flagsOnly = await request(app).get('/v1/admin/config/change-log?target=FLAG').expect(200);
      expect((flagsOnly.body as { total: number }).total).toBe(1);
      const subject = await request(app).get('/v1/admin/config/change-log?subject=disputes').expect(200);
      expect((subject.body as { total: number }).total).toBe(2);
    });
  });

  describe('change log is append-only', () => {
    it('refuses UPDATE and DELETE, even for the owner, and gives the runtime role no more than INSERT and SELECT', async () => {
      const admin = await staffActor(['config.manage']);
      await request(appFor(admin))
        .put('/v1/admin/config/settings/disputes/appeal_window_days')
        .send({ value: 2, reason: REASON })
        .expect(200);
      await expect(
        t.owner().query('UPDATE config.config_change_log SET reason = $1', ['edited']),
      ).rejects.toThrow();
      await expect(t.owner().query('DELETE FROM config.config_change_log')).rejects.toThrow();
      await expect(t.app().query('DELETE FROM config.config_change_log')).rejects.toThrow();
      await expect(
        t.app().query('UPDATE config.config_change_log SET reason = $1', ['edited']),
      ).rejects.toThrow();
    });
  });
});
