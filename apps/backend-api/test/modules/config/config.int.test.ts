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
import { createIdentityAuth } from '../../../src/modules/identity/index.js';
import { createConfigModule } from '../../../src/modules/config/module.js';
import {
  createTestRedis,
  outboxEventTypes,
  redisReady,
  seedUser,
  testConfig,
  testLogger,
} from '../identity/support.js';
import type { KomtruModule, ModuleContext } from '../../../src/platform/module.js';
import type { EventEnvelope } from '@komtru/shared-types';

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

  /** Identity's own hook, so a refused staff call is audited exactly as it is in production. */
  const onDenied = () =>
    createIdentityAuth({ db: db(), redis, config: testConfig(), logger: testLogger }).onAccessDenied;

  const appFor = (actor: Actor, accessorOverride?: () => ReturnType<typeof accessor>) => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    mountRoutes(configAdminRoutes({ db, accessor: accessorOverride ?? (() => accessor()) }), {
      logger: testLogger,
      onDenied: onDenied(),
      resolveActor: () => Promise.resolve(actor),
      rateLimit: () => Promise.resolve(),
    })(router);
    app.use('/v1', router);
    app.use(notFound);
    app.use(errorHandler(testLogger, () => undefined));
    return app;
  };

  const put = (
    app: express.Express,
    body: Record<string, unknown>,
    path = '/v1/admin/config/settings/disputes/appeal_window_days',
  ) => request(app).put(path).send(body);

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
  });

  describe('admin routes', () => {
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

    it('audits a refused write: DENIED row naming the route, the permission and the stated reason', async () => {
      const viewer = await staffActor(['config.view']);
      await put(appFor(viewer), { value: 8, reason: REASON }).expect(403);
      const { userId } = await seedUser(t.app());
      const consumer = actorFor(
        testPrincipal(userId, { scope: 'CONSUMER', permissions: new Set(['config.manage']) }),
      );
      await put(appFor(consumer), { value: 8, reason: REASON }).expect(403);

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
          route: 'PUT /admin/config/settings/:namespace/:key',
          permission: 'config.manage',
          denied: 'ROUTE_PERMISSION',
          reason: REASON,
        },
      });
      expect(rows[1]).toMatchObject({
        actor_user_id: userId,
        outcome: 'DENIED',
        metadata: { permission: 'config.manage', denied: 'ROUTE_SCOPE', reason: REASON },
      });
      expect(await countOf(t.app(), 'config.config_change_log')).toBe(0);
    });

    it('prefers the body reason to the header, and refuses a reason that is not a string', async () => {
      const admin = await staffActor(['config.manage']);
      const app = appFor(admin);
      await request(app)
        .put('/v1/admin/config/settings/disputes/appeal_window_days')
        .set('X-Admin-Reason', 'from the header')
        .send({ value: 4, reason: 'from the body' })
        .expect(200);
      const { rows } = await t.app().query<{ reason: string }>('SELECT reason FROM config.config_change_log');
      expect(rows.map((r) => r.reason)).toEqual(['from the body']);

      await put(app, { value: 5, reason: 42 }).expect(422);
      await put(app, { value: 5, reason: { text: 'x' } }).expect(422);
      expect(await countOf(t.app(), 'config.config_change_log')).toBe(1);
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

  describe("event subscribers (the module's own registration)", () => {
    type Handler = (envelope: EventEnvelope, tx: unknown) => Promise<unknown>;

    /** Starts the real module against a recording bus, and returns the handlers it registered. */
    const startModule = async (
      redisClient: Redis,
    ): Promise<{ module: KomtruModule; handlers: Map<string, Handler> }> => {
      const handlers = new Map<string, Handler>();
      const module = createConfigModule();
      await module.start?.({
        db: db(),
        redis: redisClient,
        logger: testLogger,
        events: {
          subscribe: (subscription: { name: string; handler: Handler }) => {
            handlers.set(subscription.name, subscription.handler);
          },
        },
      } as unknown as ModuleContext);
      return { module, handlers };
    };

    const envelope = (payload: unknown): EventEnvelope => ({ payload }) as unknown as EventEnvelope;

    it('registers both subscribers', async () => {
      const { handlers } = await startModule(redis);
      expect([...handlers.keys()].sort()).toEqual([
        'config.on-feature-flag-toggled',
        'config.on-setting-changed',
      ]);
    });

    it('deletes the cached setting when the event is delivered, and delivering it twice is fine', async () => {
      const { handlers } = await startModule(redis);
      const settings = accessor();
      expect(await settings.getInteger('tickets', 'reopen_window_days')).toBe(14);
      await t
        .owner()
        .query(
          `UPDATE config.platform_settings SET value = '3' WHERE namespace = 'tickets' AND key = 'reopen_window_days'`,
        );
      // Still the cached value until the subscriber runs.
      expect(await settings.getInteger('tickets', 'reopen_window_days')).toBe(14);

      const handler = handlers.get('config.on-setting-changed');
      const event = envelope({ namespace: 'tickets', key: 'reopen_window_days', oldValue: 14, newValue: 3 });
      await handler?.(event, {});
      expect(await redis.get('config:setting:tickets.reopen_window_days')).toBeNull();
      await handler?.(event, {});
      expect(await settings.getInteger('tickets', 'reopen_window_days')).toBe(3);
    });

    it('deletes the cached flag on a toggle event, twice over', async () => {
      const { handlers } = await startModule(redis);
      const settings = accessor();
      expect(await settings.isEnabled('some.flag')).toBe(false);
      expect(await redis.get('config:flag:some.flag')).toBe('0');
      await t
        .owner()
        .query(
          `INSERT INTO config.feature_flags (code, description, enabled) VALUES ('some.flag', 'x', true)`,
        );
      const handler = handlers.get('config.on-feature-flag-toggled');
      const event = envelope({ flagCode: 'some.flag', enabled: true });
      await handler?.(event, {});
      await handler?.(event, {});
      expect(await settings.isEnabled('some.flag')).toBe(true);
    });

    it('throws when Redis is down, so the outbox redelivers', async () => {
      const { handlers } = await startModule(brokenRedis());
      await expect(
        handlers.get('config.on-setting-changed')?.(
          envelope({ namespace: 'tickets', key: 'reopen_window_days', oldValue: 14, newValue: 3 }),
          {},
        ),
      ).rejects.toThrow(/redis down/);
      await expect(
        handlers.get('config.on-feature-flag-toggled')?.(
          envelope({ flagCode: 'some.flag', enabled: true }),
          {},
        ),
      ).rejects.toThrow(/redis down/);
    });
  });

  /** A Redis whose every command fails, as it would during an outage. */
  const brokenRedis = (): Redis => {
    const fail = () => Promise.reject(new Error('redis down'));
    return { get: fail, set: fail, del: fail } as unknown as Redis;
  };

  describe('a Redis outage', () => {
    it('falls back to Postgres on reads and still lets a PUT succeed', async () => {
      const broken = createConfigAccessor(db(), brokenRedis(), testLogger);
      expect(await broken.getInteger('park', 'pin_max_attempts')).toBe(3);
      expect(await broken.isEnabled('no.such_flag')).toBe(false);

      const admin = await staffActor(['config.manage']);
      const res = await request(appFor(admin, () => broken))
        .put('/v1/admin/config/settings/park/pin_max_attempts')
        .send({ value: 4, reason: REASON })
        .expect(200);
      expect(res.body).toMatchObject({ value: 4 });
      expect(await broken.getInteger('park', 'pin_max_attempts')).toBe(4);
    });
  });

  describe('flag creation races', () => {
    it('lets two concurrent creates of one code both succeed, as a create and an update', async () => {
      const a = await staffActor(['config.manage']);
      const b = await staffActor(['config.manage']);
      const send = (actor: Actor, enabled: boolean) =>
        request(appFor(actor))
          .put('/v1/admin/config/flags/race.flag')
          .send({ enabled, description: 'A raced flag', reason: REASON });
      const [first, second] = await Promise.all([send(a, true), send(b, false)]);
      expect([first.status, second.status]).toEqual([200, 200]);
      expect(await countOf(t.app(), 'config.feature_flags')).toBe(1);
      // One creation and, unless both asked for the same state, one change on top of it.
      const logged =
        (await t.app().query<{ n: number }>('SELECT count(*)::int AS n FROM config.config_change_log'))
          .rows[0]?.n ?? 0;
      expect(logged).toBeGreaterThanOrEqual(1);
      expect(logged).toBeLessThanOrEqual(2);
    });
  });

  describe('atomicity', () => {
    const rows = async () => ({
      value: (
        await t
          .app()
          .query<{ value: unknown }>(
            `SELECT value FROM config.platform_settings WHERE namespace = 'disputes' AND key = 'appeal_window_days'`,
          )
      ).rows[0]?.value,
      log: await countOf(t.app(), 'config.config_change_log'),
      audit: (
        await t
          .app()
          .query<{ n: number }>(
            `SELECT count(*)::int AS n FROM identity.identity_audit_log WHERE action = 'ADMIN_CONFIG_SETTING_CHANGED'`,
          )
      ).rows[0]?.n,
      outbox: (await outboxEventTypes(t.app())).length,
    });

    it.each([
      ['the outbox', 'platform.outbox'],
      ['the admin audit row', 'identity.identity_audit_log'],
      ['the change log', 'config.config_change_log'],
    ])('leaves the setting, log, audit row and outbox untouched when %s fails', async (_label, table) => {
      const before = await rows();
      const admin = await staffActor(['config.manage']);
      // A CHECK that rejects every new row: NOT VALID keeps the (empty) existing rows out of it.
      await t.owner().query(`ALTER TABLE ${table} ADD CONSTRAINT t048_force_fail CHECK (false) NOT VALID`);
      try {
        await put(appFor(admin), { value: 2, reason: REASON }).expect(500);
      } finally {
        await t.owner().query(`ALTER TABLE ${table} DROP CONSTRAINT t048_force_fail`);
      }
      expect(await rows()).toEqual(before);
      expect(before.value).toBe(7);
    });
  });
});
