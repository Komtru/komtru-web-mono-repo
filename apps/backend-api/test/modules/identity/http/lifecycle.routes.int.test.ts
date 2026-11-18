// F-081: `GET /me` reports each contact channel and whether it is proven, because the verification
// screen draws a badge per channel and `verification_level` alone cannot say which one is missing.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { lifecycleRoutes } from '../../../../src/modules/identity/http/routes/lifecycle.routes.js';
import { errorHandler, notFound } from '../../../../src/platform/errors.js';
import { mountRoutes } from '../../../../src/platform/http/mount.js';
import { type Actor } from '../../../../src/platform/http/principal.js';
import { testActor } from '../../../support/actors.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { seedUser, testLogger } from '../support.js';

describe.runIf(infraEnabled)('GET /me contacts (F-081)', () => {
  const t = useTestDatabase();

  const appFor = (actor: Actor) => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    mountRoutes(lifecycleRoutes({ db: t.db(), logger: testLogger }), {
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

  const addEmail = (userId: string, email: string, verified: boolean) =>
    t.app().query(
      `INSERT INTO identity.user_emails (user_id, email, email_normal, is_primary, verified_at)
       VALUES ($1, $2, $2, true, ${verified ? 'now()' : 'NULL'})`,
      [userId, email],
    );

  const addPhone = (userId: string, phone: string, verified: boolean) =>
    t.app().query(
      `INSERT INTO identity.user_phones (user_id, phone_e164, country_code, is_primary, verified_at)
       VALUES ($1, $2, 'NG', true, ${verified ? 'now()' : 'NULL'})`,
      [userId, phone],
    );

  const getMe = async (userId: string) =>
    request(appFor(testActor(userId)))
      .get('/v1/me')
      .expect(200);

  it('reports each contact channel, masked, with its verified state', async () => {
    const { userId } = await seedUser(t.app());
    await addEmail(userId, 'unproven@example.test', false);
    await addPhone(userId, '+2348100000001', true);

    const { body } = await getMe(userId);

    expect(body.contacts.phone).toEqual({
      present: true,
      masked: expect.stringContaining('•••'),
      verified: true,
    });
    expect(body.contacts.email).toEqual({
      present: true,
      masked: expect.stringContaining('•••'),
      verified: false,
    });
  });

  it('never returns the address itself, only the mask', async () => {
    const { userId } = await seedUser(t.app());
    await addEmail(userId, 'secret@example.test', true);

    const { body } = await getMe(userId);

    expect(JSON.stringify(body)).not.toContain('secret@example.test');
  });

  it('reports a channel the account does not have at all', async () => {
    const { userId } = await seedUser(t.app());
    await addPhone(userId, '+2348100000002', true);

    const { body } = await getMe(userId);

    expect(body.contacts.email).toEqual({ present: false, masked: null, verified: false });
  });
});
