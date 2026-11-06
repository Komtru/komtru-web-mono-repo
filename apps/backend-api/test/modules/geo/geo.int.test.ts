// T-046 against a real database and Redis: the seed, the unique index, the dropdown APIs and their
// cache, the staff write path (audit row, outbox event, cache invalidation) and city requests.
//
// Needs migration 0036 (the geo schema); skipped unless KOMTRU_INFRA_TESTS=1.
import express from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../src/db/index.js';
import { geoAdminRoutes } from '../../../src/modules/geo/http/admin.routes.js';
import { geoPublicRoutes } from '../../../src/modules/geo/http/public.routes.js';
import { createGeoCache, type GeoCache } from '../../../src/modules/geo/infrastructure/redis/cache.js';
import { seedRows } from '../../../src/modules/geo/domain/seed.js';
import { seedLocations } from '../../../src/modules/geo/services/seed.service.js';
import { createIdentityAuth } from '../../../src/modules/identity/index.js';
import { errorHandler, notFound } from '../../../src/platform/errors.js';
import { mountRoutes } from '../../../src/platform/http/mount.js';
import { ANONYMOUS_ACTOR, actorFor, type Actor } from '../../../src/platform/http/principal.js';
import { testPrincipal } from '../../support/actors.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import {
  createTestRedis,
  outboxEventTypes,
  redisReady,
  seedUser,
  testConfig,
  testLogger,
} from '../identity/support.js';

interface City {
  id: string;
  stateId: string;
  name: string;
  active: boolean;
  stateName?: string;
  aliases?: string[];
}
interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
const body = <T>(res: request.Response) => res.body as T;

const REASON = 'ticket 7001: confirmed with the Jos hub operator';

describe.runIf(infraEnabled)('location catalog (T-046)', () => {
  const t = useTestDatabase();
  const db = (): Db => createDb(t.app());
  let redis: Redis;
  let cache: GeoCache;

  beforeAll(async () => {
    redis = createTestRedis();
    await redisReady(redis);
    cache = createGeoCache(redis, testLogger);
  });
  afterAll(async () => {
    await redis.quit();
  });
  beforeEach(async () => {
    await seedLocations(db());
    // The database is emptied and reseeded with new ids before each test; a page cached by the last
    // test would name states that no longer exist.
    await cache.purge();
  });

  const staffActor = async (permissions: string[]): Promise<Actor> => {
    const { userId } = await seedUser(t.app());
    return actorFor(testPrincipal(userId, { scope: 'STAFF', permissions: new Set(permissions) }));
  };
  const consumer = async (): Promise<{ actor: Actor; userId: string }> => {
    const { userId } = await seedUser(t.app());
    return { actor: actorFor(testPrincipal(userId)), userId };
  };

  const appFor = (actor: Actor) => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    const deps = { db, cache: () => cache };
    mountRoutes([...geoPublicRoutes(deps), ...geoAdminRoutes(deps)], {
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

  const stateId = async (code: string): Promise<string> => {
    const { rows } = await t
      .owner()
      .query<{ id: string }>(`SELECT id FROM geo.states WHERE code = $1`, [code]);
    const id = rows[0]?.id;
    if (!id) throw new Error(`no state ${code}`);
    return id;
  };
  const cityId = async (code: string, name: string): Promise<string> => {
    const { rows } = await t
      .owner()
      .query<{ id: string }>(
        `SELECT c.id FROM geo.cities c JOIN geo.states s ON s.id = c.state_id WHERE s.code = $1 AND c.name = $2`,
        [code, name],
      );
    const id = rows[0]?.id;
    if (!id) throw new Error(`no city ${name}`);
    return id;
  };
  const clearOutbox = () => t.owner().query(`DELETE FROM platform.outbox`);
  const auditActions = async (): Promise<string[]> => {
    const { rows } = await t
      .owner()
      .query<{ action: string }>(
        `SELECT action FROM identity.identity_audit_log WHERE action LIKE 'ADMIN_GEO_%' ORDER BY occurred_at, id`,
      );
    return rows.map((r) => r.action);
  };

  describe('seed', () => {
    it('inserts the 36 states and the FCT and the reviewed cities, and a second run changes nothing', async () => {
      const count = async (table: string) =>
        Number((await t.owner().query<{ n: string }>(`SELECT count(*) AS n FROM geo.${table}`)).rows[0]?.n);
      expect(await count('states')).toBe(37);
      const cities = await count('cities');
      expect(cities).toBe(seedRows().cities.length);
      await seedLocations(db());
      expect(await count('states')).toBe(37);
      expect(await count('cities')).toBe(cities);
    });

    it('never resurrects a city staff renamed or deactivated, and never deletes one', async () => {
      const admin = await staffActor(['geo.manage']);
      const app = appFor(admin);
      const ikeja = await cityId('LA', 'Ikeja');
      const apapa = await cityId('LA', 'Apapa');
      await request(app)
        .patch(`/v1/admin/geo/cities/${ikeja}`)
        .send({ name: 'Ikeja GRA', reason: REASON })
        .expect(200);
      await request(app)
        .post(`/v1/admin/geo/cities/${apapa}/deactivate`)
        .send({ reason: REASON })
        .expect(200);
      const before = Number(
        (await t.owner().query<{ n: string }>(`SELECT count(*) AS n FROM geo.cities`)).rows[0]?.n,
      );

      await seedLocations(db());

      const { rows } = await t
        .owner()
        .query<{ name: string; active: boolean }>(
          `SELECT name, active FROM geo.cities WHERE id IN ($1, $2) ORDER BY name`,
          [ikeja, apapa],
        );
      expect(rows).toEqual([
        { name: 'Apapa', active: false },
        { name: 'Ikeja GRA', active: true },
      ]);
      expect(
        Number((await t.owner().query<{ n: string }>(`SELECT count(*) AS n FROM geo.cities`)).rows[0]?.n),
      ).toBe(before);
    });
  });

  describe('uniqueness', () => {
    it('the index refuses the same normalised name twice in one state, and allows it in another', async () => {
      const lagos = await stateId('LA');
      const oyo = await stateId('OY');
      await expect(
        t
          .owner()
          .query(`INSERT INTO geo.cities (state_id, name, normalised_name) VALUES ($1, 'IKEJA', 'ikeja')`, [
            lagos,
          ]),
      ).rejects.toThrow(/cities_state_normalised_name_unique/);
      await t
        .owner()
        .query(`INSERT INTO geo.cities (state_id, name, normalised_name) VALUES ($1, 'Ikeja', 'ikeja')`, [
          oyo,
        ]);
    });

    it('adding "port-harcourt" in Rivers is a 409 naming the city that is already there', async () => {
      const app = appFor(await staffActor(['geo.manage']));
      const res = await request(app)
        .post('/v1/admin/geo/cities')
        .send({ stateId: await stateId('RI'), name: ' port-harcourt ', reason: REASON })
        .expect(409);
      expect(res.body).toMatchObject({
        code: 'CONFLICT',
        cityId: await cityId('RI', 'Port Harcourt'),
        active: true,
      });
    });

    it('two simultaneous adds of one new city make one city and one 409', async () => {
      const app = appFor(await staffActor(['geo.manage']));
      const plateau = await stateId('PL');
      const send = () =>
        request(app)
          .post('/v1/admin/geo/cities')
          .send({ stateId: plateau, name: 'Barkin Ladi', reason: REASON });
      const results = await Promise.all([send(), send()]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    });
  });

  describe('dropdown APIs', () => {
    it('lists the 37 states alphabetically, and pages through them by cursor without a repeat', async () => {
      const app = appFor(ANONYMOUS_ACTOR);
      const all = body<Page<{ name: string }>>(
        await request(app).get('/v1/geo/states?limit=100').expect(200),
      );
      expect(all.items).toHaveLength(37);
      expect(all.nextCursor).toBeNull();
      const names = all.items.map((s) => s.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const res: request.Response = await request(app)
          .get(`/v1/geo/states?limit=10${cursor ? `&cursor=${cursor}` : ''}`)
          .expect(200);
        const page = body<Page<{ id: string }>>(res);
        seen.push(...page.items.map((s) => s.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen).toHaveLength(37);
      expect(new Set(seen).size).toBe(37);
    });

    it('lists only the active cities of a state, and a deactivated one stays readable by id', async () => {
      const admin = await staffActor(['geo.manage']);
      const lagos = await stateId('LA');
      const apapa = await cityId('LA', 'Apapa');
      await request(appFor(admin))
        .post(`/v1/admin/geo/cities/${apapa}/deactivate`)
        .send({ reason: REASON })
        .expect(200);

      const app = appFor(ANONYMOUS_ACTOR);
      const list = body<Page<City>>(
        await request(app).get(`/v1/geo/states/${lagos}/cities?limit=100`).expect(200),
      );
      expect(list.items.map((c) => c.name)).not.toContain('Apapa');
      expect(list.items.map((c) => c.name)).toContain('Ikeja');
      expect(list.items.every((c) => c.active)).toBe(true);

      const one = body<City>(await request(app).get(`/v1/geo/cities/${apapa}`).expect(200));
      expect(one).toMatchObject({ name: 'Apapa', active: false, stateName: 'Lagos' });
    });

    it('answers 404 for an unknown state or city', async () => {
      const app = appFor(ANONYMOUS_ACTOR);
      const nobody = '0190b0a0-0000-7000-8000-00000000dead';
      await request(app).get(`/v1/geo/states/${nobody}/cities`).expect(404);
      await request(app).get(`/v1/geo/cities/${nobody}`).expect(404);
    });

    it('typeahead matches a name prefix, an alias prefix and narrows to a state', async () => {
      const app = appFor(ANONYMOUS_ACTOR);
      const names = async (query: string) =>
        body<Page<City>>(await request(app).get(`/v1/geo/cities?${query}&limit=100`).expect(200)).items.map(
          (c) => c.name,
        );

      const ik = await names('q=ik');
      expect(ik).toEqual(expect.arrayContaining(['Ikeja', 'Ikorodu', 'Ikere-Ekiti', 'Ikot Ekpene']));
      expect(ik).not.toContain('Ibadan');
      expect(await names('q=PH')).toContain('Port Harcourt');
      expect(await names('q=port-h')).toEqual(['Port Harcourt']);
      expect(await names('q=ife')).toContain('Ile-Ife');
      expect(await names(`q=ik&stateId=${await stateId('LA')}`)).toEqual(['Ikeja', 'Ikorodu']);
      expect(await names('q=zzzz')).toEqual([]);
    });

    it('typeahead with no q pages every active city, and gives the state name with each', async () => {
      const app = appFor(ANONYMOUS_ACTOR);
      const first = body<Page<City>>(await request(app).get('/v1/geo/cities?limit=50').expect(200));
      expect(first.items).toHaveLength(50);
      expect(first.nextCursor).not.toBeNull();
      expect(first.items.every((c) => typeof c.stateName === 'string')).toBe(true);
    });

    it('rejects a cursor taken from another list', async () => {
      const app = appFor(ANONYMOUS_ACTOR);
      const stateCursor = Buffer.from(JSON.stringify({ x: 'y' })).toString('base64url');
      await request(app).get(`/v1/geo/states?cursor=${stateCursor}`).expect(422);
    });
  });

  describe('the cache', () => {
    it('serves a repeat read from Redis, and a staff change shows on the very next read', async () => {
      const app = appFor(ANONYMOUS_ACTOR);
      const admin = appFor(await staffActor(['geo.manage']));
      const plateau = await stateId('PL');
      const list = async () =>
        body<Page<City>>(
          await request(app).get(`/v1/geo/states/${plateau}/cities?limit=100`).expect(200),
        ).items.map((c) => c.name);

      expect(await list()).not.toContain('Barkin Ladi');

      // A write that bypasses this module (and so never bumps the version) is invisible: proof the
      // second read really came from the cache.
      await t
        .owner()
        .query(`INSERT INTO geo.cities (state_id, name, normalised_name) VALUES ($1, 'Mangu', 'mangu')`, [
          plateau,
        ]);
      expect(await list()).not.toContain('Mangu');

      // A change through the staff route invalidates, so both the new city and the earlier raw
      // insert appear at once.
      await request(admin)
        .post('/v1/admin/geo/cities')
        .send({ stateId: plateau, name: 'Barkin Ladi', reason: REASON })
        .expect(201);
      const after = await list();
      expect(after).toContain('Barkin Ladi');
      expect(after).toContain('Mangu');
    });

    it('invalidates typeahead too, for every prefix at once', async () => {
      const app = appFor(ANONYMOUS_ACTOR);
      const admin = appFor(await staffActor(['geo.manage']));
      const search = async () =>
        body<Page<City>>(await request(app).get('/v1/geo/cities?q=barkin').expect(200)).items.length;
      expect(await search()).toBe(0);
      await request(admin)
        .post('/v1/admin/geo/cities')
        .send({ stateId: await stateId('PL'), name: 'Barkin Ladi', reason: REASON })
        .expect(201);
      expect(await search()).toBe(1);
      const jos = await cityId('PL', 'Jos');
      await request(admin)
        .post(`/v1/admin/geo/cities/${jos}/deactivate`)
        .send({ reason: REASON })
        .expect(200);
      expect(
        body<Page<City>>(await request(app).get('/v1/geo/cities?q=jos').expect(200)).items.map((c) => c.name),
      ).not.toContain('Jos');
    });

    it('still answers when Redis is unreachable', async () => {
      const broken = createGeoCache(
        {
          get: () => Promise.reject(new Error('down')),
          set: () => Promise.reject(new Error('down')),
          incr: () => Promise.reject(new Error('down')),
        } as unknown as Redis,
        testLogger,
      );
      const app = express();
      const router = express.Router();
      mountRoutes(geoPublicRoutes({ db, cache: () => broken }), {
        logger: testLogger,
        resolveActor: () => Promise.resolve(ANONYMOUS_ACTOR),
        rateLimit: () => Promise.resolve(),
        idempotency: (_input, run) => run(),
      })(router);
      app.use('/v1', router);
      const res = await request(app).get('/v1/geo/states?limit=100').expect(200);
      expect(body<Page<City>>(res).items).toHaveLength(37);
    });
  });

  describe('staff city changes', () => {
    it('require geo.manage and a reason', async () => {
      const lagos = await stateId('LA');
      const viewer = await staffActor(['config.view']);
      await request(appFor(viewer))
        .post('/v1/admin/geo/cities')
        .send({ stateId: lagos, name: 'Ketu', reason: REASON })
        .expect(403);
      await request(appFor(await consumer().then((c) => c.actor)))
        .get('/v1/admin/geo/states')
        .expect(403);

      const admin = appFor(await staffActor(['geo.manage']));
      await request(admin).post('/v1/admin/geo/cities').send({ stateId: lagos, name: 'Ketu' }).expect(400);
      await request(admin)
        .post('/v1/admin/geo/cities')
        .send({ stateId: lagos, name: 'Ketu', reason: '   ' })
        .expect(400);
      await request(admin)
        .post('/v1/admin/geo/cities')
        .set('X-Admin-Reason', REASON)
        .send({ stateId: lagos, name: 'Ketu' })
        .expect(201);
    });

    it('add writes the city, one audit row and one outbox event', async () => {
      const admin = appFor(await staffActor(['geo.manage']));
      await clearOutbox();
      const res = await request(admin)
        .post('/v1/admin/geo/cities')
        .send({ stateId: await stateId('LA'), name: 'Ketu', aliases: ['Alapere', 'ketu'], reason: REASON })
        .expect(201);
      expect(body<City>(res)).toMatchObject({ name: 'Ketu', active: true, aliases: ['alapere'] });
      expect(await auditActions()).toEqual(['ADMIN_GEO_CITY_ADDED']);
      expect(await outboxEventTypes(t.app())).toEqual(['geo.catalog.changed']);
      const { rows } = await t
        .owner()
        .query<{ metadata: unknown }>(
          `SELECT metadata FROM identity.identity_audit_log WHERE action = 'ADMIN_GEO_CITY_ADDED'`,
        );
      expect(rows[0]?.metadata).toMatchObject({ name: 'Ketu', reason: REASON, via: 'ADMIN' });
    });

    it('rename keeps the old name searchable as an alias, and writes nothing for a no-op', async () => {
      const admin = appFor(await staffActor(['geo.manage']));
      const pub = appFor(ANONYMOUS_ACTOR);
      const id = await cityId('OY', 'Ogbomosho');
      await clearOutbox();
      const res = await request(admin)
        .patch(`/v1/admin/geo/cities/${id}`)
        .send({ name: 'Ogbomoso Town', reason: REASON })
        .expect(200);
      expect(body<City>(res).aliases).toEqual(expect.arrayContaining(['ogbomosho', 'ogbomoso']));
      const found = body<Page<City>>(await request(pub).get('/v1/geo/cities?q=ogbomosho').expect(200));
      expect(found.items.map((c) => c.name)).toEqual(['Ogbomoso Town']);
      expect(await auditActions()).toEqual(['ADMIN_GEO_CITY_UPDATED']);

      await clearOutbox();
      await request(admin)
        .patch(`/v1/admin/geo/cities/${id}`)
        .send({ name: 'Ogbomoso Town', reason: REASON })
        .expect(200);
      expect(await outboxEventTypes(t.app())).toEqual([]);
      expect(await auditActions()).toEqual(['ADMIN_GEO_CITY_UPDATED']);
    });

    it('refuses a rename onto another city of the state, and an alias that is another city’s name', async () => {
      const admin = appFor(await staffActor(['geo.manage']));
      const ikeja = await cityId('LA', 'Ikeja');
      await request(admin)
        .patch(`/v1/admin/geo/cities/${ikeja}`)
        .send({ name: 'Lekki', reason: REASON })
        .expect(409);
      await request(admin)
        .patch(`/v1/admin/geo/cities/${ikeja}`)
        .send({ aliases: ['lekki'], reason: REASON })
        .expect(422);
    });

    it('deactivates and reactivates, each with an audit row and an event, and is quiet when repeated', async () => {
      const admin = appFor(await staffActor(['geo.manage']));
      const id = await cityId('KN', 'Wudil');
      await clearOutbox();
      await request(admin).post(`/v1/admin/geo/cities/${id}/deactivate`).send({ reason: REASON }).expect(200);
      await request(admin).post(`/v1/admin/geo/cities/${id}/deactivate`).send({ reason: REASON }).expect(200);
      await request(admin).post(`/v1/admin/geo/cities/${id}/activate`).send({ reason: REASON }).expect(200);
      expect(await auditActions()).toEqual(['ADMIN_GEO_CITY_DEACTIVATED', 'ADMIN_GEO_CITY_ACTIVATED']);
      expect(await outboxEventTypes(t.app())).toEqual(['geo.catalog.changed', 'geo.catalog.changed']);
    });

    it('has no delete: DELETE is a 404 and the row is still there', async () => {
      const admin = appFor(await staffActor(['geo.manage']));
      const id = await cityId('KN', 'Rano');
      await request(admin).delete(`/v1/admin/geo/cities/${id}`).expect(404);
      expect((await t.owner().query(`SELECT 1 FROM geo.cities WHERE id = $1`, [id])).rowCount).toBe(1);
    });

    it('lists states with counts, and a state’s cities with the inactive ones', async () => {
      const admin = appFor(await staffActor(['geo.manage']));
      const id = await cityId('KN', 'Rano');
      await request(admin).post(`/v1/admin/geo/cities/${id}/deactivate`).send({ reason: REASON }).expect(200);
      const states = body<Page<{ code: string; cityCount: number; activeCityCount: number }>>(
        await request(admin).get('/v1/admin/geo/states?limit=100').expect(200),
      );
      expect(states.items.find((s) => s.code === 'KN')).toMatchObject({ cityCount: 3, activeCityCount: 2 });
      const kano = await stateId('KN');
      const all = body<Page<City>>(
        await request(admin).get(`/v1/admin/geo/states/${kano}/cities`).expect(200),
      );
      expect(all.items.map((c) => c.name)).toContain('Rano');
      const activeOnly = body<Page<City>>(
        await request(admin).get(`/v1/admin/geo/states/${kano}/cities?includeInactive=false`).expect(200),
      );
      expect(activeOnly.items.map((c) => c.name)).not.toContain('Rano');
    });
  });

  describe('city requests', () => {
    const submit = (app: express.Express, state: string, cityName: string) =>
      request(app).post('/v1/geo/city-requests').send({ stateId: state, cityName });

    it('records a request as PENDING, and a repeat is the same request', async () => {
      const { actor, userId } = await consumer();
      const app = appFor(actor);
      const plateau = await stateId('PL');
      const first = await submit(app, plateau, 'Jos East').expect(201);
      expect(body<{ status: string; cityName: string }>(first)).toMatchObject({
        status: 'PENDING',
        cityName: 'Jos East',
      });
      const again = await submit(app, plateau, '  jos  east ').expect(201);
      expect(body<{ id: string }>(again).id).toBe(body<{ id: string }>(first).id);
      const { rows } = await t
        .owner()
        .query(`SELECT 1 FROM geo.city_requests WHERE requested_by_user_id = $1`, [userId]);
      expect(rows).toHaveLength(1);
    });

    it('is a 409 with the city id when the name is already listed, by name or alias', async () => {
      const app = appFor((await consumer()).actor);
      const rivers = await stateId('RI');
      const res = await submit(app, rivers, 'PH').expect(409);
      expect(res.body).toMatchObject({ cityId: await cityId('RI', 'Port Harcourt') });
      await submit(app, rivers, 'port harcourt').expect(409);
    });

    it('needs a consumer session and a real state', async () => {
      await submit(appFor(ANONYMOUS_ACTOR), await stateId('PL'), 'Jos East').expect(401);
      await submit(
        appFor((await consumer()).actor),
        '0190b0a0-0000-7000-8000-00000000dead',
        'Jos East',
      ).expect(404);
    });

    it('add creates the city and settles every pending request for the name, notifying each requester', async () => {
      const plateau = await stateId('PL');
      const a = await consumer();
      const b = await consumer();
      const c = await consumer();
      await submit(appFor(a.actor), plateau, 'Jos East').expect(201);
      await submit(appFor(b.actor), plateau, 'JOS-EAST').expect(201);
      await submit(appFor(c.actor), plateau, 'Barkin Ladi').expect(201);

      const admin = appFor(await staffActor(['geo.manage']));
      const queue = body<Page<{ id: string; requesterCount: number; cityName: string }>>(
        await request(admin).get('/v1/admin/geo/city-requests?status=PENDING').expect(200),
      );
      expect(queue.items.map((r) => r.requesterCount)).toEqual([2, 2, 1]);
      const first = queue.items[0];
      if (!first) throw new Error('empty queue');

      await clearOutbox();
      const res = await request(admin)
        .post(`/v1/admin/geo/city-requests/${first.id}/add`)
        .send({ name: 'Jos East' })
        .expect(200);
      expect(body<{ status: string; resolvedCityId: string }>(res)).toMatchObject({ status: 'ADDED' });

      const { rows } = await t
        .owner()
        .query<{ status: string; resolved_city_id: string | null }>(
          `SELECT status, resolved_city_id FROM geo.city_requests ORDER BY created_at`,
        );
      expect(rows.map((r) => r.status)).toEqual(['ADDED', 'ADDED', 'PENDING']);
      expect(rows[0]?.resolved_city_id).toBe(rows[1]?.resolved_city_id);
      expect((await outboxEventTypes(t.app())).sort()).toEqual([
        'geo.catalog.changed',
        'geo.city_request.decided',
        'geo.city_request.decided',
      ]);
      expect(await auditActions()).toEqual(['ADMIN_GEO_CITY_ADDED', 'ADMIN_GEO_CITY_REQUEST_ADDED']);

      // The new city reaches the dropdown at once.
      const list = body<Page<City>>(
        await request(appFor(ANONYMOUS_ACTOR)).get(`/v1/geo/states/${plateau}/cities?limit=100`),
      );
      expect(list.items.map((x) => x.name)).toContain('Jos East');
    });

    it('add of a name already in the catalog is a 409 that points at the city, and decides nothing', async () => {
      const plateau = await stateId('PL');
      const user = await consumer();
      // Deactivated cities are not "listed", so the user may ask; adding it anew must then be refused.
      const jos = await cityId('PL', 'Jos');
      const admin = appFor(await staffActor(['geo.manage']));
      await request(admin)
        .post(`/v1/admin/geo/cities/${jos}/deactivate`)
        .send({ reason: REASON })
        .expect(200);
      const created = await submit(appFor(user.actor), plateau, 'Jos').expect(201);
      const res = await request(admin)
        .post(`/v1/admin/geo/city-requests/${body<{ id: string }>(created).id}/add`)
        .send({})
        .expect(409);
      expect(res.body).toMatchObject({ cityId: jos, active: false });
      const { rows } = await t.owner().query(`SELECT status FROM geo.city_requests`);
      expect(rows).toEqual([{ status: 'PENDING' }]);
    });

    it('merge folds the request into an active city of the same state and keeps the typed name as an alias', async () => {
      const plateau = await stateId('PL');
      const user = await consumer();
      const created = await submit(appFor(user.actor), plateau, 'Jos North').expect(201);
      const admin = appFor(await staffActor(['geo.manage']));
      const jos = await cityId('PL', 'Jos');
      await clearOutbox();
      const res = await request(admin)
        .post(`/v1/admin/geo/city-requests/${body<{ id: string }>(created).id}/merge`)
        .send({ cityId: jos })
        .expect(200);
      expect(body<{ status: string; resolvedCityId: string }>(res)).toMatchObject({
        status: 'MERGED',
        resolvedCityId: jos,
      });
      expect((await outboxEventTypes(t.app())).sort()).toEqual([
        'geo.catalog.changed',
        'geo.city_request.decided',
      ]);
      const found = body<Page<City>>(
        await request(appFor(ANONYMOUS_ACTOR)).get('/v1/geo/cities?q=jos%20north').expect(200),
      );
      expect(found.items.map((c) => c.name)).toEqual(['Jos']);
    });

    it('merge refuses a city in another state or a deactivated one', async () => {
      const plateau = await stateId('PL');
      const created = await submit(appFor((await consumer()).actor), plateau, 'Jos North').expect(201);
      const id = body<{ id: string }>(created).id;
      const admin = appFor(await staffActor(['geo.manage']));
      await request(admin)
        .post(`/v1/admin/geo/city-requests/${id}/merge`)
        .send({ cityId: await cityId('LA', 'Ikeja') })
        .expect(422);
      const bukuru = await cityId('PL', 'Bukuru');
      await request(admin)
        .post(`/v1/admin/geo/cities/${bukuru}/deactivate`)
        .send({ reason: REASON })
        .expect(200);
      await request(admin)
        .post(`/v1/admin/geo/city-requests/${id}/merge`)
        .send({ cityId: bukuru })
        .expect(422);
    });

    it('reject needs a reason, records it, and tells the requester', async () => {
      const created = await submit(appFor((await consumer()).actor), await stateId('PL'), 'Atlantis').expect(
        201,
      );
      const id = body<{ id: string }>(created).id;
      const admin = appFor(await staffActor(['geo.manage']));
      await request(admin).post(`/v1/admin/geo/city-requests/${id}/reject`).send({}).expect(400);
      await clearOutbox();
      const res = await request(admin)
        .post(`/v1/admin/geo/city-requests/${id}/reject`)
        .send({ reason: 'Not a place in Plateau' })
        .expect(200);
      expect(body<{ status: string; decisionReason: string }>(res)).toMatchObject({
        status: 'REJECTED',
        decisionReason: 'Not a place in Plateau',
      });
      expect(await outboxEventTypes(t.app())).toEqual(['geo.city_request.decided']);
      expect(await auditActions()).toEqual(['ADMIN_GEO_CITY_REQUEST_REJECTED']);
    });

    it('a decided request cannot be decided again, even by a second reviewer at the same moment', async () => {
      const created = await submit(appFor((await consumer()).actor), await stateId('PL'), 'Atlantis').expect(
        201,
      );
      const id = body<{ id: string }>(created).id;
      const one = appFor(await staffActor(['geo.manage']));
      const two = appFor(await staffActor(['geo.manage']));
      const results = await Promise.all([
        request(one).post(`/v1/admin/geo/city-requests/${id}/reject`).send({ reason: 'first' }),
        request(two).post(`/v1/admin/geo/city-requests/${id}/reject`).send({ reason: 'second' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)?.body).toMatchObject({ code: 'INVALID_TRANSITION' });
      const { rows } = await t
        .owner()
        .query(`SELECT 1 FROM identity.identity_audit_log WHERE action = 'ADMIN_GEO_CITY_REQUEST_REJECTED'`);
      expect(rows).toHaveLength(1);
    });

    it('the queue needs geo.manage and pages oldest first', async () => {
      const plateau = await stateId('PL');
      for (const name of ['Alpha Town', 'Beta Town', 'Gamma Town']) {
        await submit(appFor((await consumer()).actor), plateau, name).expect(201);
      }
      await request(appFor(await staffActor(['config.view'])))
        .get('/v1/admin/geo/city-requests')
        .expect(403);
      const admin = appFor(await staffActor(['geo.manage']));
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const res: request.Response = await request(admin)
          .get(`/v1/admin/geo/city-requests?limit=2${cursor ? `&cursor=${cursor}` : ''}`)
          .expect(200);
        const page = body<Page<{ cityName: string }>>(res);
        seen.push(...page.items.map((r) => r.cityName));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen).toEqual(['Alpha Town', 'Beta Town', 'Gamma Town']);
    });
  });
});
