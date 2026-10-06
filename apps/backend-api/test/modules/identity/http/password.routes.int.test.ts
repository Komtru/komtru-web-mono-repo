// Login, forgot, reset and change over HTTP (screens E4, AC2, AC3).
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../../src/app.js';
import { DEFAULT_TERMS_VERSION } from '../../../../src/modules/identity/domain/terms.js';
import { createIdentityAuth } from '../../../../src/modules/identity/index.js';
import { createIdempotencyGate } from '../../../../src/platform/http/idempotency.js';
import { mountRoutes } from '../../../../src/platform/http/mount.js';
import { createRateLimitGate } from '../../../../src/platform/http/rateLimit.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { createTestRedis, redisReady, testConfig, testLogger } from '../support.js';

const bodyOf = <T>(response: { body: unknown }): T => response.body as T;

interface Registered {
  userId: string;
  challengeId: string;
}
interface Session {
  accessToken: string;
  refreshToken: string;
  nextStep: string;
  user: { id: string };
}
interface Forgot {
  status: 'SENT';
  challengeId: string;
  expiresAt: number;
  maskedDestination: string | null;
}
interface Reset {
  resetToken: string;
  nextStep: string;
}
interface Changed {
  ok: true;
  revokedSessions: number;
}
interface Problem {
  code: string;
}

const PHONE = '0802 341 5567';
const E164 = '+2348023415567';
const PASSWORD = 'a sturdy passphrase 1';
const NEXT_PASSWORD = 'a different sturdy phrase 2';

describe.runIf(infraEnabled)('login and the password routes over HTTP', () => {
  const t = useTestDatabase();
  const config = testConfig();
  let redis: Redis;
  let app: Express;

  beforeEach(async () => {
    redis ??= createTestRedis();
    await redisReady(redis);
    const auth = createIdentityAuth({ db: t.db(), redis, config, logger: testLogger });
    app = createApp({
      config,
      logger: testLogger,
      mountV1: mountRoutes(auth.routes ?? [], {
        logger: testLogger,
        idempotency: createIdempotencyGate({ db: t.db(), redis, logger: testLogger }),
        rateLimit: createRateLimitGate({ redis, logger: testLogger, keyPrefix: `rl-${randomUUID()}` }),
        resolveActor: auth.resolveActor,
      }),
    });
  });

  afterAll(() => {
    redis?.disconnect();
  });

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

  /** Register by phone, verify, then set a first password. The screen E2 → E3 → onboarding path. */
  const signUp = async (): Promise<{ userId: string; session: Session }> => {
    const registered = bodyOf<Registered>(
      await request(app)
        .post('/v1/auth/register')
        .send({ channel: 'PHONE', phone: PHONE, acceptedTermsVersion: DEFAULT_TERMS_VERSION }),
    );
    const session = bodyOf<Session>(
      await request(app)
        .post('/v1/auth/verify-otp')
        .send({ challengeId: registered.challengeId, code: await codeFor(registered.challengeId) }),
    );
    await request(app)
      .post('/v1/auth/password/change')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ newPassword: PASSWORD });
    return { userId: registered.userId, session };
  };

  const signIn = (password = PASSWORD, identifier = E164) =>
    request(app).post('/v1/auth/login').send({ identifier, password });

  it('allows a first password with no currentPassword for a phone-path user (M1 §9.3)', async () => {
    const registered = bodyOf<Registered>(
      await request(app)
        .post('/v1/auth/register')
        .send({ channel: 'PHONE', phone: PHONE, acceptedTermsVersion: DEFAULT_TERMS_VERSION }),
    );
    const session = bodyOf<Session>(
      await request(app)
        .post('/v1/auth/verify-otp')
        .send({ challengeId: registered.challengeId, code: await codeFor(registered.challengeId) }),
    );
    expect(session.nextStep).toBe('SET_PASSWORD');

    const response = await request(app)
      .post('/v1/auth/password/change')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ newPassword: PASSWORD });
    expect(response.status).toBe(200);

    const { rows } = await t
      .app()
      .query<{ action: string }>(
        `SELECT action FROM identity.identity_audit_log WHERE action LIKE 'PASSWORD%'`,
      );
    expect(rows.map((r) => r.action)).toEqual(['PASSWORD_SET']);
  });

  it('requires currentPassword once the user has one', async () => {
    const { session } = await signUp();
    const response = await request(app)
      .post('/v1/auth/password/change')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ newPassword: NEXT_PASSWORD });

    expect(response.status).toBe(422);
    expect(bodyOf<{ errors: { path: string }[] }>(response).errors[0]?.path).toBe('currentPassword');
  });

  it('refuses a wrong currentPassword', async () => {
    const { session } = await signUp();
    const response = await request(app)
      .post('/v1/auth/password/change')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ currentPassword: 'not the password', newPassword: NEXT_PASSWORD });
    expect(response.status).toBe(401);
    expect(bodyOf<Problem>(response).code).toBe('INVALID_CREDENTIALS');
  });

  it('signs in with the password that was just set (screen E4)', async () => {
    const { userId } = await signUp();
    const response = await signIn();
    expect(response.status).toBe(200);
    expect(bodyOf<Session>(response).user.id).toBe(userId);
  });

  it('keeps the calling session alive while killing the others (M1 §17)', async () => {
    const { session } = await signUp();
    // A second device.
    const other = bodyOf<Session>(await signIn());

    const changed = await request(app)
      .post('/v1/auth/password/change')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: NEXT_PASSWORD });
    expect(changed.status).toBe(200);
    expect(bodyOf<Changed>(changed).revokedSessions).toBeGreaterThanOrEqual(1);

    // The caller's own session still works.
    const mine = await request(app).get('/v1/me/terms').set('Authorization', `Bearer ${session.accessToken}`);
    expect(mine.status).toBe(200);

    // The sibling's refresh token is dead.
    const refreshed = await request(app).post('/v1/auth/refresh').send({ refreshToken: other.refreshToken });
    expect(refreshed.status).toBe(401);
  });

  it('refuses to reuse one of the last five passwords', async () => {
    const { session } = await signUp();
    const response = await request(app)
      .post('/v1/auth/password/change')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(response.status).toBe(422);
  });

  it('refuses the change route to a caller with no session', async () => {
    const response = await request(app).post('/v1/auth/password/change').send({ newPassword: NEXT_PASSWORD });
    expect(response.status).toBe(401);
  });

  it('masks only what the caller typed, never what the account holds', async () => {
    await signUp();
    await t.owner().query(`UPDATE identity.users SET username = 'janedoe', username_skeleton = 'janedoe'`);

    const byHandle = bodyOf<Forgot>(
      await request(app).post('/v1/auth/password/forgot').send({ identifier: 'janedoe' }),
    );
    expect(byHandle.maskedDestination).toBeNull();

    const byPhone = bodyOf<Forgot>(
      await request(app).post('/v1/auth/password/forgot').send({ identifier: PHONE }),
    );
    expect(byPhone.maskedDestination).toBe('+23480•••5567');
  });

  it('resets the password, revokes EVERY session and bumps the epoch (screen AC3)', async () => {
    const { userId, session } = await signUp();

    const forgot = bodyOf<Forgot>(
      await request(app).post('/v1/auth/password/forgot').send({ identifier: PHONE }),
    );
    const verified = bodyOf<Reset>(
      await request(app)
        .post('/v1/auth/verify-otp')
        .send({ challengeId: forgot.challengeId, code: await codeFor(forgot.challengeId) }),
    );
    expect(verified.nextStep).toBe('SET_PASSWORD');
    expect(verified.resetToken).toBeTruthy();

    const reset = await request(app)
      .post('/v1/auth/password/reset')
      .send({ resetToken: verified.resetToken, newPassword: NEXT_PASSWORD });
    expect(reset.status).toBe(200);

    // Every session, including the one that asked for the reset: a recovery means the account may
    // have been in somebody else's hands.
    expect(
      (await request(app).post('/v1/auth/refresh').send({ refreshToken: session.refreshToken })).status,
    ).toBe(401);

    const { rows } = await t
      .app()
      .query<{ sessions_epoch: number }>(`SELECT sessions_epoch FROM identity.users WHERE id = $1`, [userId]);
    expect(rows[0]?.sessions_epoch).toBeGreaterThan(1);

    // And the new password works.
    expect((await signIn(NEXT_PASSWORD)).status).toBe(200);
    expect((await signIn(PASSWORD)).status).toBe(401);
  });

  it('does not sign the holder in: verifying a reset code returns a token and no session', async () => {
    await signUp();
    const forgot = bodyOf<Forgot>(
      await request(app).post('/v1/auth/password/forgot').send({ identifier: PHONE }),
    );
    const response = await request(app)
      .post('/v1/auth/verify-otp')
      .send({ challengeId: forgot.challengeId, code: await codeFor(forgot.challengeId) });

    expect(response.body).not.toHaveProperty('accessToken');
    expect(response.body).not.toHaveProperty('refreshToken');
  });

  it('refuses a reset token after its single attempt is spent', async () => {
    await signUp();
    const forgot = bodyOf<Forgot>(
      await request(app).post('/v1/auth/password/forgot').send({ identifier: PHONE }),
    );
    const verified = bodyOf<Reset>(
      await request(app)
        .post('/v1/auth/verify-otp')
        .send({ challengeId: forgot.challengeId, code: await codeFor(forgot.challengeId) }),
    );

    expect(
      (
        await request(app)
          .post('/v1/auth/password/reset')
          .send({ resetToken: verified.resetToken, newPassword: NEXT_PASSWORD })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post('/v1/auth/password/reset')
          .send({ resetToken: verified.resetToken, newPassword: 'a third sturdy phrase 3' })
      ).status,
    ).toBe(422);
  });

  it('does NOT burn the reset token when the new password is refused', async () => {
    await signUp();
    const forgot = bodyOf<Forgot>(
      await request(app).post('/v1/auth/password/forgot').send({ identifier: PHONE }),
    );
    const verified = bodyOf<Reset>(
      await request(app)
        .post('/v1/auth/verify-otp')
        .send({ challengeId: forgot.challengeId, code: await codeFor(forgot.challengeId) }),
    );

    // REUSED is the one rejection that survives validatePassword, and the one a real person hits.
    const refused = await request(app)
      .post('/v1/auth/password/reset')
      .send({ resetToken: verified.resetToken, newPassword: PASSWORD });
    expect(refused.status).toBe(422);
    expect(bodyOf<Problem>(refused).code).toBe('VALIDATION_FAILED');

    // The token must still work: otherwise the user is told to pick another password and then finds
    // their only route back is /auth/password/forgot, three an hour away.
    const retried = await request(app)
      .post('/v1/auth/password/reset')
      .send({ resetToken: verified.resetToken, newPassword: NEXT_PASSWORD });
    expect(retried.status).toBe(200);
  });

  it('refuses a new password that contains the account\u2019s own identifier, on reset too', async () => {
    await signUp();
    const forgot = bodyOf<Forgot>(
      await request(app).post('/v1/auth/password/forgot').send({ identifier: PHONE }),
    );
    const verified = bodyOf<Reset>(
      await request(app)
        .post('/v1/auth/verify-otp')
        .send({ challengeId: forgot.challengeId, code: await codeFor(forgot.challengeId) }),
    );

    // No corpus catches '2348023415567abc'; it is only weak for this account.
    const response = await request(app)
      .post('/v1/auth/password/reset')
      .send({ resetToken: verified.resetToken, newPassword: '2348023415567abc' });
    expect(response.status).toBe(422);
    expect(bodyOf<{ errors: { message: string }[] }>(response).errors[0]?.message).toMatch(/your own/i);
  });

  it('refuses a changed password that contains the account\u2019s own identifier', async () => {
    const { session } = await signUp();
    const response = await request(app)
      .post('/v1/auth/password/change')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: '2348023415567abc' });
    expect(response.status).toBe(422);
  });

  it('refuses a reset token after fifteen minutes', async () => {
    await signUp();
    const forgot = bodyOf<Forgot>(
      await request(app).post('/v1/auth/password/forgot').send({ identifier: PHONE }),
    );
    const verified = bodyOf<Reset>(
      await request(app)
        .post('/v1/auth/verify-otp')
        .send({ challengeId: forgot.challengeId, code: await codeFor(forgot.challengeId) }),
    );
    await t.owner().query(`UPDATE identity.otp_challenges SET expires_at = now() - interval '1 second'
               WHERE consumed_at IS NULL`);

    const response = await request(app)
      .post('/v1/auth/password/reset')
      .send({ resetToken: verified.resetToken, newPassword: NEXT_PASSWORD });
    expect(response.status).toBe(422);
  });

  it('answers a real challenge id with a wrong secret exactly as it answers rubbish', async () => {
    await signUp();
    const forgot = bodyOf<Forgot>(
      await request(app).post('/v1/auth/password/forgot').send({ identifier: PHONE }),
    );
    const verified = bodyOf<Reset>(
      await request(app)
        .post('/v1/auth/verify-otp')
        .send({ challengeId: forgot.challengeId, code: await codeFor(forgot.challengeId) }),
    );
    const challengeId = verified.resetToken.split('.')[0];

    const wrongSecret = await request(app)
      .post('/v1/auth/password/reset')
      .send({ resetToken: `${challengeId ?? ''}.not-the-secret`, newPassword: NEXT_PASSWORD });
    const rubbish = await request(app)
      .post('/v1/auth/password/reset')
      .send({ resetToken: "'; DROP TABLE identity.users; --", newPassword: NEXT_PASSWORD });

    expect(wrongSecret.status).toBe(422);
    expect(rubbish.status).toBe(422);
    expect(rubbish.body).toEqual(wrongSecret.body);
  });

  it('publishes identity.password.changed with viaRecovery true on reset and false on change', async () => {
    const { session } = await signUp();
    await request(app)
      .post('/v1/auth/password/change')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: NEXT_PASSWORD });

    const forgot = bodyOf<Forgot>(
      await request(app).post('/v1/auth/password/forgot').send({ identifier: PHONE }),
    );
    const verified = bodyOf<Reset>(
      await request(app)
        .post('/v1/auth/verify-otp')
        .send({ challengeId: forgot.challengeId, code: await codeFor(forgot.challengeId) }),
    );
    await request(app)
      .post('/v1/auth/password/reset')
      .send({ resetToken: verified.resetToken, newPassword: 'a third sturdy phrase 3' });

    const { rows } = await t.app().query<{ payload: { viaRecovery: boolean } }>(
      `SELECT payload FROM platform.outbox WHERE event_type = 'identity.password.changed'
          ORDER BY occurred_at`,
    );
    // The first PASSWORD_SET during signUp, then the change, then the reset.
    expect(rows.map((r) => r.payload.viaRecovery)).toEqual([false, false, true]);
  });

  it('writes an identity_audit_log row for every password route (S10)', async () => {
    const { session } = await signUp();
    await request(app)
      .post('/v1/auth/password/change')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: NEXT_PASSWORD });
    await request(app).post('/v1/auth/password/forgot').send({ identifier: PHONE });

    const { rows } = await t
      .app()
      .query<{ action: string }>(`SELECT action FROM identity.identity_audit_log ORDER BY id`);
    expect(rows.map((r) => r.action)).toContain('PASSWORD_SET');
    expect(rows.map((r) => r.action)).toContain('PASSWORD_CHANGED');
    expect(rows.map((r) => r.action)).toContain('PASSWORD_RESET_REQUESTED');
  });
});
