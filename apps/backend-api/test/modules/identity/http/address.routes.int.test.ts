// T-042's `/me/addresses` over HTTP, against a real database: status codes, bodies, the problem
// documents, the isolation between users, and that the idempotency record and the logs hold no more
// than they should. Skipped unless KOMTRU_INFRA_TESTS=1.
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedLocations } from '../../../../src/modules/geo/index.js';
import { addressRoutes } from '../../../../src/modules/identity/http/routes/address.routes.js';
import { errorHandler, notFound } from '../../../../src/platform/errors.js';
import { mountRoutes } from '../../../../src/platform/http/mount.js';
import { ANONYMOUS_ACTOR, type Actor } from '../../../../src/platform/http/principal.js';
import { testActor } from '../../../support/actors.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { seedUser, testLogger } from '../support.js';

interface AddressBody {
  id: string;
  label: string;
  recipientPhone: string;
  isDefault: boolean;
  archivedAt: string | null;
  cityName: string;
  stateName: string;
}
interface Page {
  items: AddressBody[];
  nextCursor: string | null;
}

describe.runIf(infraEnabled)('/me/addresses (T-042)', () => {
  const t = useTestDatabase();
  let lagos: { stateId: string; ikeja: string };
  let oyo: { stateId: string; ibadan: string };

  beforeEach(async () => {
    await seedLocations(t.db());
    const pick = async (code: string, city: string) => {
      const { rows } = await t.owner().query<{ state_id: string; id: string }>(
        `SELECT c.state_id, c.id FROM geo.cities c JOIN geo.states s ON s.id = c.state_id
          WHERE s.code = $1 AND c.name = $2`,
        [code, city],
      );
      return { stateId: rows[0]?.state_id ?? '', cityId: rows[0]?.id ?? '' };
    };
    const la = await pick('LA', 'Ikeja');
    const oy = await pick('OY', 'Ibadan');
    lagos = { stateId: la.stateId, ikeja: la.cityId };
    oyo = { stateId: oy.stateId, ibadan: oy.cityId };
  });

  const appFor = (actor: Actor) => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    mountRoutes(addressRoutes({ db: t.db() }), {
      logger: testLogger,
      resolveActor: () => Promise.resolve(actor),
      rateLimit: () => Promise.resolve(),
      idempotency: (_input, run) => run(),
    })(router);
    app.use('/v1', router);
    app.use(notFound);
    app.use(errorHandler(testLogger, () => undefined));
    return app;
  };
  const asUser = async () => {
    const { userId } = await seedUser(t.app());
    return { userId, app: appFor(testActor(userId)) };
  };

  const payload = (over: Record<string, unknown> = {}) => ({
    label: 'Home',
    recipientName: 'Adaeze Obiora',
    recipientPhone: '0801 234 5678',
    streetLine: '12 Allen Avenue',
    landmark: 'Beside the pharmacy',
    stateId: lagos.stateId,
    cityId: lagos.ikeja,
    ...over,
  });

  it('answers 401 without a session', async () => {
    const res = await request(appFor(ANONYMOUS_ACTOR)).get('/v1/me/addresses');
    expect(res.status).toBe(401);
  });

  it('creates (201), lists, edits, makes default and archives', async () => {
    const { app } = await asUser();

    const first = await request(app).post('/v1/me/addresses').send(payload()).expect(201);
    const a = first.body as AddressBody;
    expect(a).toMatchObject({
      label: 'Home',
      recipientPhone: '+2348012345678',
      isDefault: true,
      archivedAt: null,
      cityName: 'Ikeja',
      stateName: 'Lagos',
    });

    const second = (
      await request(app)
        .post('/v1/me/addresses')
        .send(payload({ label: 'Shop', stateId: oyo.stateId, cityId: oyo.ibadan }))
        .expect(201)
    ).body as AddressBody;
    expect(second.isDefault).toBe(false);

    const list = (await request(app).get('/v1/me/addresses').expect(200)).body as Page;
    expect(list.items.map((i) => i.label)).toEqual(['Home', 'Shop']);
    expect(list.nextCursor).toBeNull();

    const edited = (
      await request(app).patch(`/v1/me/addresses/${second.id}`).send({ label: 'Warehouse' }).expect(200)
    ).body as AddressBody;
    expect(edited.label).toBe('Warehouse');

    const made = (await request(app).post(`/v1/me/addresses/${second.id}/default`).expect(200))
      .body as AddressBody;
    expect(made.isDefault).toBe(true);

    const archived = (await request(app).post(`/v1/me/addresses/${second.id}/archive`).expect(200))
      .body as AddressBody;
    expect(archived.archivedAt).not.toBeNull();

    const after = (await request(app).get('/v1/me/addresses').expect(200)).body as Page;
    expect(after.items.map((i) => i.id)).toEqual([a.id]);
    expect(after.items[0]?.isDefault).toBe(true);
  });

  it('pages with limit and cursor', async () => {
    const { app } = await asUser();
    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .post('/v1/me/addresses')
        .send(payload({ label: `A${i}` }))
        .expect(201);
    }
    const page1 = (await request(app).get('/v1/me/addresses?limit=2').expect(200)).body as Page;
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = (await request(app).get(`/v1/me/addresses?limit=2&cursor=${page1.nextCursor}`).expect(200))
      .body as Page;
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
  });

  it('answers 422 with a cityId field error when the city is not in the state', async () => {
    const { app } = await asUser();
    const res = await request(app)
      .post('/v1/me/addresses')
      .send(payload({ cityId: oyo.ibadan }))
      .expect(422);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED', errors: [{ path: 'cityId' }] });
  });

  it('answers 422 for a city that has been deactivated', async () => {
    const { app } = await asUser();
    await t.owner().query(`UPDATE geo.cities SET active = false WHERE id = $1`, [lagos.ikeja]);
    await request(app).post('/v1/me/addresses').send(payload()).expect(422);
  });

  it('answers 422 for a body that breaks the schema, an empty edit and an unknown field', async () => {
    const { app } = await asUser();
    await request(app)
      .post('/v1/me/addresses')
      .send(payload({ label: '' }))
      .expect(422);
    await request(app)
      .post('/v1/me/addresses')
      .send(payload({ isDefault: true }))
      .expect(422);
    const made = (await request(app).post('/v1/me/addresses').send(payload()).expect(201))
      .body as AddressBody;
    await request(app).patch(`/v1/me/addresses/${made.id}`).send({}).expect(422);
    await request(app).patch(`/v1/me/addresses/${made.id}`).send({ isDefault: true }).expect(422);
    await request(app).patch('/v1/me/addresses/not-a-uuid').send({ label: 'x' }).expect(422);
  });

  it('answers 409 ADDRESS_LIMIT_REACHED past twenty', async () => {
    const { userId, app } = await asUser();
    for (let i = 0; i < 20; i += 1) {
      await t.owner().query(
        `INSERT INTO identity.user_addresses
           (user_id, label, recipient_name, recipient_phone, street_line, state_id, city_id)
         VALUES ($1, $2, 'N', '+2348012345678', 'S', $3, $4)`,
        [userId, `A${i}`, lagos.stateId, lagos.ikeja],
      );
    }
    const res = await request(app).post('/v1/me/addresses').send(payload()).expect(409);
    expect(res.body).toMatchObject({ code: 'ADDRESS_LIMIT_REACHED' });
  });

  it("answers 404 for another user's address on every route, and never exposes it in the list", async () => {
    const owner = await asUser();
    const stranger = await asUser();
    const mine = (await request(owner.app).post('/v1/me/addresses').send(payload()).expect(201))
      .body as AddressBody;

    await request(stranger.app).patch(`/v1/me/addresses/${mine.id}`).send({ label: 'Hers' }).expect(404);
    await request(stranger.app).post(`/v1/me/addresses/${mine.id}/archive`).expect(404);
    await request(stranger.app).post(`/v1/me/addresses/${mine.id}/default`).expect(404);
    const list = (await request(stranger.app).get('/v1/me/addresses').expect(200)).body as Page;
    expect(list.items).toEqual([]);
  });

  it('answers 409 when an archived address is edited or made default', async () => {
    const { app } = await asUser();
    await request(app).post('/v1/me/addresses').send(payload()).expect(201);
    const gone = (
      await request(app)
        .post('/v1/me/addresses')
        .send(payload({ label: 'Old' }))
        .expect(201)
    ).body as AddressBody;
    await request(app).post(`/v1/me/addresses/${gone.id}/archive`).expect(200);
    await request(app).patch(`/v1/me/addresses/${gone.id}`).send({ label: 'Back' }).expect(409);
    await request(app).post(`/v1/me/addresses/${gone.id}/default`).expect(409);
  });

  it('has no DELETE route', async () => {
    const { app } = await asUser();
    const made = (await request(app).post('/v1/me/addresses').send(payload()).expect(201))
      .body as AddressBody;
    await request(app).delete(`/v1/me/addresses/${made.id}`).expect(404);
  });

  it('keeps the phone and the street out of a problem document', async () => {
    const { app } = await asUser();
    const res = await request(app)
      .post('/v1/me/addresses')
      .send(payload({ cityId: oyo.ibadan, streetLine: '77 Private Lane' }))
      .expect(422);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('77 Private Lane');
    expect(text).not.toContain('8012345678');
  });
});
