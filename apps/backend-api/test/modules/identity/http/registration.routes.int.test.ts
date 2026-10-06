// Registration and OTP verification over HTTP (screens E2, E3, E3b, TOS1, TOS2).
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../../src/app.js';
import { DEFAULT_TERMS_VERSION } from '../../../../src/modules/identity/domain/terms.js';
import { createIdentityAuth } from '../../../../src/modules/identity/index.js';
import type { AppConfig } from '../../../../src/config/env.js';
import { createIdempotencyGate } from '../../../../src/platform/http/idempotency.js';
import { mountRoutes } from '../../../../src/platform/http/mount.js';
import { createRateLimitGate } from '../../../../src/platform/http/rateLimit.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { createTestRedis, redisReady, testConfig, testLogger } from '../support.js';

/** supertest types `response.body` as `any`; every read in this file goes through `bodyOf`. */
const bodyOf = <T>(response: { body: unknown }): T => response.body as T;

interface Registered {
  userId: string;
  publicId: string;
  status: string;
  challengeId: string;
  nextStep: string;
  expiresAt: number;
  maskedDestination: string;
  delivered: boolean;
}
interface Session {
  verified: true;
  nextStep: string;
  accessToken: string;
  refreshToken: string;
  scope: string;
  user: { status: string; verificationLevel: string };
}
interface Resent {
  challengeId: string;
  expiresAt: number;
}
interface Terms {
  upToDate: boolean;
  acceptedTermsVersion: string | null;
}
interface Problem {
  code: string;
  attemptsRemaining?: number;
}

const PHONE = '0802 341 5567';
const E164 = '+2348023415567';

describe.runIf(infraEnabled)('registration over HTTP', () => {
  const t = useTestDatabase();
  const config = testConfig();
  let redis: Redis;
  let app: Express;

  const buildApp = (appConfig: AppConfig): Express => {
    const auth = createIdentityAuth({ db: t.db(), redis, config: appConfig, logger: testLogger });
    return createApp({
      config: appConfig,
      logger: testLogger,
      mountV1: mountRoutes(auth.routes ?? [], {
        logger: testLogger,
        idempotency: createIdempotencyGate({ db: t.db(), redis, logger: testLogger }),
        rateLimit: createRateLimitGate({ redis, logger: testLogger, keyPrefix: `rl-${randomUUID()}` }),
        resolveActor: auth.resolveActor,
      }),
    });
  };

  beforeEach(async () => {
    redis ??= createTestRedis();
    await redisReady(redis);
    app = buildApp(config);
  });

  afterAll(() => {
    // Never flush: this Redis database is shared with every other test file vitest runs in parallel.
    redis?.disconnect();
  });

  const registerPhone = (overrides: Record<string, unknown> = {}, target = app) =>
    request(target)
      .post('/v1/auth/register')
      .send({
        channel: 'PHONE',
        phone: PHONE,
        fullName: 'Jane Doe',
        acceptedTermsVersion: DEFAULT_TERMS_VERSION,
        ...overrides,
      });

  const verify = (challengeId: string, code: string, fingerprint?: string) =>
    request(app)
      .post('/v1/auth/verify-otp')
      .send({ challengeId, code, ...(fingerprint ? { deviceFingerprint: fingerprint } : {}) });

  /** The code is only ever visible in the event payload; this is how a test learns it. */
  const codeFor = async (challengeId: string): Promise<string> => {
    const { rows } = await t
      .app()
      .query<{ payload: { challengeId: string; code: string } }>(
        `SELECT payload FROM platform.outbox WHERE event_type = 'identity.otp.requested'`,
      );
    const match = rows.map((r) => r.payload).find((p) => p.challengeId === challengeId);
    if (!match) throw new Error(`no identity.otp.requested for ${challengeId}`);
    return match.code;
  };

  const eventTypes = async (): Promise<string[]> =>
    (
      await t
        .app()
        .query<{ event_type: string }>(
          `SELECT event_type FROM platform.outbox ORDER BY occurred_at, event_id`,
        )
    ).rows.map((r) => r.event_type);

  /** Register, read the code out of the outbox, verify. Returns the signed-in session. */
  const signUp = async (): Promise<{ registered: Registered; session: Session }> => {
    const registered = bodyOf<Registered>(await registerPhone());
    const session = bodyOf<Session>(
      await verify(registered.challengeId, await codeFor(registered.challengeId)),
    );
    return { registered, session };
  };

  it('registers phone-first with no password and answers 201 with a challenge (screen E2)', async () => {
    const response = await registerPhone();
    const body = bodyOf<Registered>(response);

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      status: 'PENDING_VERIFICATION',
      nextStep: 'VERIFY_PHONE',
      maskedDestination: '+23480•••5567',
    });
    expect(body.challengeId).toBeTruthy();
    // Nothing in the response is the code.
    expect(JSON.stringify(body)).not.toContain(await codeFor(body.challengeId));
  });

  it('requires a password on the email path (M1 §9.3 sets it later on the phone path)', async () => {
    const response = await request(app)
      .post('/v1/auth/register')
      .send({ channel: 'EMAIL', email: 'jane@example.com', acceptedTermsVersion: DEFAULT_TERMS_VERSION });
    expect(response.status).toBe(422);
  });

  it('refuses an acceptedTermsVersion that is not the current one (screen TOS1)', async () => {
    const response = await registerPhone({ acceptedTermsVersion: '2020-01-01' });
    expect(response.status).toBe(409);
    const { rows } = await t.app().query(`SELECT 1 FROM identity.users`);
    expect(rows).toEqual([]);
  });

  it('records terms_version, privacy_version, consent_recorded_at and the opt-in (NDPA §15)', async () => {
    const body = bodyOf<Registered>(await registerPhone());
    const { rows } = await t.app().query<{
      terms_version: string;
      privacy_version: string;
      consent_recorded_at: Date | null;
      marketing_opt_in: boolean;
    }>(
      `SELECT terms_version, privacy_version, consent_recorded_at, marketing_opt_in
          FROM identity.users WHERE id = $1`,
      [body.userId],
    );

    expect(rows[0]).toMatchObject({
      terms_version: DEFAULT_TERMS_VERSION,
      privacy_version: DEFAULT_TERMS_VERSION,
      marketing_opt_in: false,
    });
    expect(rows[0]?.consent_recorded_at).not.toBeNull();
  });

  it('drops an unparseable X-Forwarded-For rather than handing it to an inet column', async () => {
    const proxied = buildApp(testConfig({ TRUST_PROXY_HOPS: '1' }));
    const response = await request(proxied)
      .post('/v1/auth/register')
      .set('X-Forwarded-For', "'; DROP TABLE identity.users; --")
      .send({ channel: 'PHONE', phone: PHONE, acceptedTermsVersion: DEFAULT_TERMS_VERSION });

    expect(response.status).toBe(201);
    const { rows } = await t
      .app()
      .query<{ registration_ip: string | null; consent_ip: string | null }>(
        `SELECT registration_ip, consent_ip FROM identity.users WHERE id = $1`,
        [bodyOf<Registered>(response).userId],
      );
    expect(rows[0]).toEqual({ registration_ip: null, consent_ip: null });
  });

  it('answers 409 when the phone is already VERIFIED on another account', async () => {
    await signUp();
    expect((await registerPhone()).status).toBe(409);
  });

  it('allows a second account to hold the same UNVERIFIED number, as the partial index does', async () => {
    expect((await registerPhone()).status).toBe(201);
    expect((await registerPhone()).status).toBe(201);
  });

  it('verifies the code, turns the user ACTIVE and returns a CONSUMER session (screen E3)', async () => {
    const registered = bodyOf<Registered>(await registerPhone());
    const response = await verify(
      registered.challengeId,
      await codeFor(registered.challengeId),
      'fingerprint-one',
    );
    const session = bodyOf<Session>(response);

    expect(response.status).toBe(200);
    expect(session).toMatchObject({
      verified: true,
      scope: 'CONSUMER',
      // No password yet: M1 §9.3's phone path sets one after the channel is proven.
      nextStep: 'SET_PASSWORD',
      user: { status: 'ACTIVE', verificationLevel: 'UNVERIFIED' },
    });
    expect(session.accessToken).toBeTruthy();
    expect(session.refreshToken).toBeTruthy();

    const { rows } = await t
      .app()
      .query<{ verified_at: Date | null }>(
        `SELECT verified_at FROM identity.user_phones WHERE phone_e164 = $1`,
        [E164],
      );
    expect(rows[0]?.verified_at).not.toBeNull();
  });

  it('returns the wrong-code state with the attempts left (screen E3b)', async () => {
    const registered = bodyOf<Registered>(await registerPhone());
    const response = await verify(registered.challengeId, '000000');

    expect(response.status).toBe(422);
    expect(bodyOf<Problem>(response)).toMatchObject({ code: 'OTP_INVALID', attemptsRemaining: 4 });
  });

  it('answers a spent challenge, an expired one and an unknown id alike, with no attempt count', async () => {
    const registered = bodyOf<Registered>(await registerPhone());
    for (let i = 0; i < 5; i += 1) await verify(registered.challengeId, '000000');

    const spent = bodyOf<Problem>(await verify(registered.challengeId, '000000'));
    const unknown = bodyOf<Problem>(await verify(randomUUID(), '000000'));

    expect(spent.code).toBe('OTP_INVALID');
    expect(spent.attemptsRemaining).toBeUndefined();
    expect(unknown).toEqual(spent);
  });

  it('resends by issuing a NEW challenge and killing the old one', async () => {
    const registered = bodyOf<Registered>(await registerPhone());
    const oldCode = await codeFor(registered.challengeId);

    const response = await request(app)
      .post('/v1/auth/otp/resend')
      .send({ challengeId: registered.challengeId });
    const resent = bodyOf<Resent>(response);

    expect(response.status).toBe(200);
    expect(resent.challengeId).not.toBe(registered.challengeId);
    // No mask: the client already has one from the call that created the challenge, and returning
    // the account's here would tell a caller holding a forgot-password id whether it matched.
    expect(response.body).not.toHaveProperty('maskedDestination');
    expect((await verify(registered.challengeId, oldCode)).status).toBe(422);
    expect((await verify(resent.challengeId, await codeFor(resent.challengeId))).status).toBe(200);
  });

  it('answers 429 once the per-destination send budget is spent (S4)', async () => {
    const registered = bodyOf<Registered>(await registerPhone());
    let last = registered.challengeId;
    // Registration was the first send; two resends fill the three-in-ten-minutes window.
    for (let i = 0; i < 2; i += 1) {
      const response = await request(app).post('/v1/auth/otp/resend').send({ challengeId: last });
      expect(response.status).toBe(200);
      last = bodyOf<Resent>(response).challengeId;
    }
    expect((await request(app).post('/v1/auth/otp/resend').send({ challengeId: last })).status).toBe(429);
  });

  it('answers a resend for an unknown challenge without saying so', async () => {
    const response = await request(app).post('/v1/auth/otp/resend').send({ challengeId: randomUUID() });
    expect(response.status).toBe(422);
    expect(bodyOf<Problem>(response).code).toBe('OTP_INVALID');
  });

  it('verifies the contact the code was ISSUED for, not whichever is primary now', async () => {
    const registered = bodyOf<Registered>(await registerPhone());
    const code = await codeFor(registered.challengeId);

    // Another number becomes primary between the code being sent and the code being presented.
    await t
      .owner()
      .query(`UPDATE identity.user_phones SET is_primary = false WHERE user_id = $1`, [registered.userId]);
    await t.owner().query(
      `INSERT INTO identity.user_phones (user_id, phone_e164, country_code, is_primary)
           VALUES ($1, '+2348099999999', 'NG', true)`,
      [registered.userId],
    );

    // `destination_hash` is an HMAC of the number the code went to; recomputing it from the row we
    // are about to mark verified is the only thing standing between this and a bypass.
    const response = await verify(registered.challengeId, code);
    expect(response.status).toBe(422);
    const { rows } = await t.app().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM identity.user_phones
          WHERE user_id = $1 AND verified_at IS NOT NULL`,
      [registered.userId],
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('says when nothing was sent, rather than claiming a code is on its way', async () => {
    // Fill the per-destination budget with three registrations on the same unverified number.
    for (let i = 0; i < 3; i += 1) expect((await registerPhone()).status).toBe(201);
    const fourth = await registerPhone();
    expect(fourth.status).toBe(201);
    expect(bodyOf<Registered & { delivered: boolean }>(fourth).delivered).toBe(false);
  });

  it('writes an identity_audit_log row before it returns success (S10)', async () => {
    await signUp();
    const { rows } = await t
      .app()
      .query<{ action: string }>(`SELECT action FROM identity.identity_audit_log ORDER BY id`);
    expect(rows.map((r) => r.action)).toEqual(['USER_REGISTERED', 'PHONE_VERIFIED']);
  });

  it('writes no address or code into the audit log (S12)', async () => {
    const registered = bodyOf<Registered>(await registerPhone());
    const code = await codeFor(registered.challengeId);
    await verify(registered.challengeId, code);

    const { rows } = await t
      .app()
      .query<{ metadata: unknown }>(`SELECT metadata FROM identity.identity_audit_log`);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(code);
    expect(dump).not.toContain(E164);
    expect(dump).not.toContain('8023415567');
  });

  it('publishes the registration, OTP and verification events', async () => {
    await signUp();
    expect((await eventTypes()).sort()).toEqual(
      [
        'identity.otp.requested',
        'identity.phone.verified',
        'identity.session.created',
        'identity.user.registered',
        'identity.user.status_changed',
      ].sort(),
    );
  });

  it('tells an existing user their terms are stale and accepts the new ones (screen TOS2)', async () => {
    const { registered, session } = await signUp();
    const bearer = `Bearer ${session.accessToken}`;

    const current = await request(app).get('/v1/me/terms').set('Authorization', bearer);
    expect(bodyOf<Terms>(current)).toMatchObject({
      upToDate: true,
      acceptedTermsVersion: DEFAULT_TERMS_VERSION,
    });

    // New copy published: the stored version is now behind.
    await t
      .owner()
      .query(`UPDATE identity.users SET terms_version = '2020-01-01' WHERE id = $1`, [registered.userId]);
    const stale = await request(app).get('/v1/me/terms').set('Authorization', bearer);
    expect(bodyOf<Terms>(stale).upToDate).toBe(false);

    const accepted = await request(app)
      .post('/v1/me/terms/accept')
      .set('Authorization', bearer)
      .send({ termsVersion: DEFAULT_TERMS_VERSION, privacyVersion: DEFAULT_TERMS_VERSION });
    expect(accepted.status).toBe(200);

    const after = await request(app).get('/v1/me/terms').set('Authorization', bearer);
    expect(bodyOf<Terms>(after).upToDate).toBe(true);
  });

  it('refuses to accept a version that is not the current one', async () => {
    const { session } = await signUp();
    const response = await request(app)
      .post('/v1/me/terms/accept')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ termsVersion: '2020-01-01', privacyVersion: '2020-01-01' });
    expect(response.status).toBe(409);
  });

  it('refuses the terms routes to a caller with no session', async () => {
    expect((await request(app).get('/v1/me/terms')).status).toBe(401);
  });
});
