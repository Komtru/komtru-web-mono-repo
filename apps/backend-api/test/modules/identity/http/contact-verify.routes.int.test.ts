// F-081 over HTTP: the four `/me` routes, their bodies and their problem documents.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { contactVerifyRoutes } from '../../../../src/modules/identity/http/routes/contact-verify.routes.js';
import { createHmacHasher } from '../../../../src/platform/crypto/hmac.js';
import { errorHandler, notFound } from '../../../../src/platform/errors.js';
import { mountRoutes } from '../../../../src/platform/http/mount.js';
import { ANONYMOUS_ACTOR, type Actor } from '../../../../src/platform/http/principal.js';
import { testActor } from '../../../support/actors.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { seedUser, testLogger } from '../support.js';
import { bodyOf } from './staff.support.js';

const hasher = createHmacHasher('pepper'.padEnd(32, 'x'));

interface StartBody {
  challengeId: string;
  maskedDestination: string;
  expiresAt: string;
  delivered: boolean;
}
interface ConfirmBody {
  status: string;
  verificationLevel: string;
  maskedDestination: string;
}
interface Problem {
  code: string;
}

describe.runIf(infraEnabled)('contact verification routes (F-081)', () => {
  const t = useTestDatabase();

  const appFor = (actor: Actor) => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    mountRoutes(contactVerifyRoutes({ db: t.db(), logger: testLogger, otpHasher: hasher }), {
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

  const post = (actor: Actor, path: string, body: object = {}) =>
    request(appFor(actor)).post(`/v1${path}`).send(body);

  const codeFor = async (challengeId: string): Promise<string> => {
    const { rows } = await t
      .owner()
      .query<{ payload: { challengeId: string; code: string } }>(
        `SELECT payload FROM platform.outbox WHERE event_type = 'identity.otp.requested' ORDER BY occurred_at`,
      );
    const match = rows.map((r) => r.payload).find((p) => p.challengeId === challengeId);
    if (!match) throw new Error(`no otp event for ${challengeId}`);
    return match.code;
  };

  const addVerifiedPhone = (userId: string, phone: string) =>
    t.owner().query(
      `INSERT INTO identity.user_phones (user_id, phone_e164, country_code, is_primary, verified_at)
       VALUES ($1, $2, 'NG', true, now())`,
      [userId, phone],
    );

  it('verifies an email end to end', async () => {
    const { userId } = await seedUser(t.app());
    await addVerifiedPhone(userId, '+2348100000030');
    const actor = testActor(userId);

    const started = await post(actor, '/me/email/verify/start', { address: 'me@example.test' });
    expect(started.status).toBe(200);
    const { challengeId, maskedDestination } = bodyOf<StartBody>(started);
    expect(maskedDestination).toContain('•••');

    const confirmed = await post(actor, '/me/email/verify/confirm', {
      challengeId,
      code: await codeFor(challengeId),
    });

    expect(confirmed.status).toBe(200);
    expect(bodyOf<ConfirmBody>(confirmed)).toMatchObject({
      status: 'VERIFIED',
      verificationLevel: 'CONTACT_VERIFIED',
    });
  });

  it('answers 409 ALREADY_VERIFIED when the channel is already proven', async () => {
    const { userId } = await seedUser(t.app());
    await addVerifiedPhone(userId, '+2348100000031');

    const res = await post(testActor(userId), '/me/phone/verify/start');

    expect(res.status).toBe(409);
    expect(bodyOf<Problem>(res).code).toBe('ALREADY_VERIFIED');
  });

  it('answers 409 CONTACT_TAKEN when somebody else has proven the address', async () => {
    const { userId: other } = await seedUser(t.app());
    const otherApp = testActor(other);
    const started = await post(otherApp, '/me/email/verify/start', { address: 'one@example.test' });
    await post(otherApp, '/me/email/verify/confirm', {
      challengeId: bodyOf<StartBody>(started).challengeId,
      code: await codeFor(bodyOf<StartBody>(started).challengeId),
    });

    const { userId } = await seedUser(t.app());
    const res = await post(testActor(userId), '/me/email/verify/start', {
      address: 'one@example.test',
    });

    expect(res.status).toBe(409);
    expect(bodyOf<Problem>(res).code).toBe('CONTACT_TAKEN');
  });

  it('answers 422 when the account has no address on that channel and none was given', async () => {
    const { userId } = await seedUser(t.app());

    const res = await post(testActor(userId), '/me/email/verify/start');

    expect(res.status).toBe(422);
    expect(bodyOf<Problem>(res).code).toBe('CONTACT_REQUIRED');
  });

  it('answers 422 for an address that cannot be made canonical', async () => {
    const { userId } = await seedUser(t.app());

    const res = await post(testActor(userId), '/me/email/verify/start', { address: 'nonsense' });

    expect(res.status).toBe(422);
  });

  it('answers 422 OTP_INVALID for a wrong code', async () => {
    const { userId } = await seedUser(t.app());
    const actor = testActor(userId);
    const started = await post(actor, '/me/email/verify/start', { address: 'wrong@example.test' });

    const res = await post(actor, '/me/email/verify/confirm', {
      challengeId: bodyOf<StartBody>(started).challengeId,
      code: '000000',
    });

    expect(res.status).toBe(422);
    expect(bodyOf<Problem>(res).code).toBe('OTP_INVALID');
  });

  it('refuses an anonymous caller', async () => {
    const res = await post(ANONYMOUS_ACTOR, '/me/email/verify/start', {
      address: 'anon@example.test',
    });

    expect(res.status).toBe(401);
  });

  it('rejects a phone that is far too long for the phone route', async () => {
    const { userId } = await seedUser(t.app());

    const res = await post(testActor(userId), '/me/phone/verify/start', {
      address: `+234${'1'.repeat(60)}`,
    });

    expect(res.status).toBe(422);
  });
});
