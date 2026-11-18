// F-081: `GET /me` reports each contact channel and whether it is proven, because the verification
// screen draws a badge per channel and `verification_level` alone cannot say which one is missing.
//
// A file of its own rather than an addition to `lifecycle.routes.int.test.ts`: that suite is T-039's,
// it signs in through the real login to exercise close/NDPA/recovery, and this needs none of that.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { lifecycleRoutes } from '../../../../src/modules/identity/http/routes/lifecycle.routes.js';
import { createHmacHasher } from '../../../../src/platform/crypto/hmac.js';
import { errorHandler, notFound } from '../../../../src/platform/errors.js';
import { mountRoutes } from '../../../../src/platform/http/mount.js';
import { type Actor } from '../../../../src/platform/http/principal.js';
import { testActor } from '../../../support/actors.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { accountDeps, seedUser, testLogger } from '../support.js';
import { bodyOf } from './staff.support.js';

describe.runIf(infraEnabled)('GET /me contacts (F-081)', () => {
  const t = useTestDatabase();

  const appFor = (actor: Actor) => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    // The password and breach deps are required by the deps type and unreachable from `GET /me`;
    // `accountDeps()` supplies them so the mount typechecks, not because this suite exercises them.
    mountRoutes(
      lifecycleRoutes({
        ...accountDeps(),
        identifierHasher: createHmacHasher('pepper-for-tests-0123456789abcdef'),
        db: t.db(),
        logger: testLogger,
      }),
      {
        logger: testLogger,
        resolveActor: () => Promise.resolve(actor),
        rateLimit: () => Promise.resolve(),
        idempotency: (_input, run) => run(),
      },
    )(router);
    app.use('/v1', router);
    app.use(notFound);
    app.use(errorHandler(testLogger, () => undefined));
    return app;
  };

  const addEmail = (userId: string, email: string, verified: boolean) =>
    t.owner().query(
      `INSERT INTO identity.user_emails (user_id, email, email_normal, is_primary, verified_at)
       VALUES ($1, $2, $2, true, ${verified ? 'now()' : 'NULL'})`,
      [userId, email],
    );

  const addPhone = (userId: string, phone: string, verified: boolean) =>
    t.owner().query(
      `INSERT INTO identity.user_phones (user_id, phone_e164, country_code, is_primary, verified_at)
       VALUES ($1, $2, 'NG', true, ${verified ? 'now()' : 'NULL'})`,
      [userId, phone],
    );

  interface Channel {
    present: boolean;
    masked: string | null;
    verified: boolean;
  }
  interface MeBody {
    contacts: { email: Channel; phone: Channel };
  }

  const getMe = async (userId: string): Promise<MeBody> =>
    bodyOf<MeBody>(
      await request(appFor(testActor(userId)))
        .get('/v1/me')
        .expect(200),
    );

  it('reports each contact channel, masked, with its verified state', async () => {
    const { userId } = await seedUser(t.app());
    await addEmail(userId, 'unproven@example.test', false);
    await addPhone(userId, '+2348100000001', true);

    const body = await getMe(userId);

    expect(body.contacts.phone.present).toBe(true);
    expect(body.contacts.phone.verified).toBe(true);
    expect(body.contacts.phone.masked).toContain('•••');

    expect(body.contacts.email.present).toBe(true);
    expect(body.contacts.email.verified).toBe(false);
    expect(body.contacts.email.masked).toContain('•••');
  });

  it('never returns the address itself, only the mask', async () => {
    const { userId } = await seedUser(t.app());
    await addEmail(userId, 'secret@example.test', true);

    const body = await getMe(userId);

    expect(JSON.stringify(body)).not.toContain('secret@example.test');
  });

  it('reports a channel the account does not have at all', async () => {
    const { userId } = await seedUser(t.app());
    await addPhone(userId, '+2348100000002', true);

    const body = await getMe(userId);

    expect(body.contacts.email).toEqual({ present: false, masked: null, verified: false });
  });

  it('prefers the PROVEN row when a channel holds both, so a verified account never badges unverified', async () => {
    const { userId } = await seedUser(t.app());
    // Both non-primary, so `is_primary` cannot break the tie: `verified_at DESC` alone is NULLS
    // FIRST in Postgres and would pick the unproven row.
    await t.owner().query(
      `INSERT INTO identity.user_emails (user_id, email, email_normal, is_primary, verified_at)
       VALUES ($1, 'proven@example.test', 'proven@example.test', false, now()),
              ($1, 'unproven@example.test', 'unproven@example.test', false, NULL)`,
      [userId],
    );

    const body = await getMe(userId);

    expect(body.contacts.email.verified).toBe(true);
  });
});
