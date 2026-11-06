// T-037: `POST /auth/staff/login`, password and MFA only, separate from consumer login.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { createTestRedis, redisReady } from '../support.js';
import {
  PASSWORD,
  assignRole,
  bodyOf,
  buildApp,
  nextCode,
  seedCatalogue,
  seedMember,
  type ChallengeBody,
  type Problem,
  type SessionBody,
} from './staff.support.js';

describe.runIf(infraEnabled)('staff sign-in (T-037)', () => {
  const t = useTestDatabase();
  let redis: Redis;
  let app: Express;

  beforeEach(async () => {
    redis ??= createTestRedis();
    await redisReady(redis);
    await seedCatalogue(t);
    app = buildApp(t, redis);
  });
  afterAll(() => {
    redis?.disconnect();
  });

  const staffLogin = (email: string, password = PASSWORD) =>
    request(app).post('/v1/auth/staff/login').send({ identifier: email, password });

  it('buys only a challenge with the password, then a STAFF session with the factor', async () => {
    const member = await seedMember(t, app, { roles: ['OPERATIONS_ADMIN'], mfa: true });

    const first = await staffLogin(member.email);
    expect(first.status).toBe(200);
    const challenge = bodyOf<ChallengeBody & { accessToken?: string; refreshToken?: string }>(first);
    expect(challenge.mfaRequired).toBe(true);
    expect(challenge.accessToken).toBeUndefined();
    expect(challenge.refreshToken).toBeUndefined();

    const totp = challenge.factors.find((factor) => factor.type === 'TOTP');
    const second = await request(app)
      .post('/v1/auth/staff/mfa/verify')
      .send({ mfaToken: challenge.mfaToken, factorId: totp?.id, code: nextCode(member) });
    expect(second.status).toBe(200);
    expect(bodyOf<SessionBody>(second).scope).toBe('STAFF');

    const { rows } = await t
      .app()
      .query<{ scope: string; amr: string[] }>(
        `SELECT scope::text AS scope, amr FROM identity.sessions WHERE user_id = $1`,
        [member.userId],
      );
    expect(rows.filter((row) => row.scope === 'STAFF')).toHaveLength(1);
    expect(rows.find((row) => row.scope === 'STAFF')?.amr).toEqual(['pwd', 'otp']);
  });

  it('keeps consumer login consumer for the same account', async () => {
    const member = await seedMember(t, app, { roles: ['OPERATIONS_ADMIN'], mfa: true });
    const first = await request(app)
      .post('/v1/auth/login')
      .send({ identifier: member.email, password: PASSWORD });
    const challenge = bodyOf<ChallengeBody>(first);
    const totp = challenge.factors.find((factor) => factor.type === 'TOTP');
    const second = await request(app)
      .post('/v1/auth/mfa/verify')
      .send({ mfaToken: challenge.mfaToken, factorId: totp?.id, code: nextCode(member) });
    expect(bodyOf<SessionBody>(second).scope).toBe('CONSUMER');
  });

  it('answers the same 401 for a wrong password, an unknown user and a user with no staff role', async () => {
    const plain = await seedMember(t, app, { mfa: true });
    const staff = await seedMember(t, app, { roles: ['OPERATIONS_ADMIN'], mfa: true });

    const wrong = await staffLogin(staff.email, 'not the password at all');
    const unknown = await staffLogin('nobody@example.com');
    const noRole = await staffLogin(plain.email);

    for (const response of [wrong, unknown, noRole]) {
      expect(response.status).toBe(401);
      expect(bodyOf<Problem>(response).code).toBe('INVALID_CREDENTIALS');
    }
    expect(bodyOf<Problem>(noRole)).toEqual(bodyOf<Problem>(wrong));
  });

  it('refuses a staff member who has not enrolled a second factor', async () => {
    const member = await seedMember(t, app, { roles: ['OPERATIONS_ADMIN'] });
    const response = await staffLogin(member.email);
    expect(response.status).toBe(401);
    expect(bodyOf<Problem>(response).code).toBe('INVALID_CREDENTIALS');
  });

  it('refuses a role that has expired, with no job having run', async () => {
    const expired = await seedMember(t, app, { mfa: true });
    await assignRole(t, expired.userId, 'KYC_ANALYST', { expiresAt: new Date(Date.now() - 60_000) });
    expect((await staffLogin(expired.email)).status).toBe(401);

    const live = await seedMember(t, app, { mfa: true });
    await assignRole(t, live.userId, 'KYC_ANALYST', { expiresAt: new Date(Date.now() + 3_600_000) });
    expect((await staffLogin(live.email)).status).toBe(200);
  });

  it('cannot even hold a dual-approval role without its second approver (the trigger refuses first)', async () => {
    const member = await seedMember(t, app, { mfa: true });
    await expect(assignRole(t, member.userId, 'FINANCE_ADMIN', { approved: false })).rejects.toThrow();
    expect((await staffLogin(member.email)).status).toBe(401);
  });

  it('does not let a consumer mfaToken open a staff session, or a staff one a consumer session', async () => {
    const member = await seedMember(t, app, { roles: ['OPERATIONS_ADMIN'], mfa: true });

    const consumer = bodyOf<ChallengeBody>(
      await request(app).post('/v1/auth/login').send({ identifier: member.email, password: PASSWORD }),
    );
    const viaStaffRoute = await request(app)
      .post('/v1/auth/staff/mfa/verify')
      .send({
        mfaToken: consumer.mfaToken,
        factorId: consumer.factors.find((f) => f.type === 'TOTP')?.id,
        code: nextCode(member),
      });
    expect(viaStaffRoute.status).toBe(401);

    const staff = bodyOf<ChallengeBody>(await staffLogin(member.email));
    const viaConsumerRoute = await request(app)
      .post('/v1/auth/mfa/verify')
      .send({
        mfaToken: staff.mfaToken,
        factorId: staff.factors.find((f) => f.type === 'TOTP')?.id,
        code: nextCode(member),
      });
    expect(viaConsumerRoute.status).toBe(401);
  });

  it('stops a role revoked between the password and the factor', async () => {
    const member = await seedMember(t, app, { roles: ['OPERATIONS_ADMIN'], mfa: true });
    const challenge = bodyOf<ChallengeBody>(await staffLogin(member.email));
    await t
      .owner()
      .query(`UPDATE identity.admin_role_assignments SET revoked_at = now() WHERE user_id = $1`, [
        member.userId,
      ]);

    const response = await request(app)
      .post('/v1/auth/staff/mfa/verify')
      .send({
        mfaToken: challenge.mfaToken,
        factorId: challenge.factors.find((f) => f.type === 'TOTP')?.id,
        code: nextCode(member),
      });
    expect(response.status).toBe(401);
  });

  it('records a rejected staff sign-in as a LOGIN_FAILED audit row', async () => {
    const member = await seedMember(t, app, { roles: ['OPERATIONS_ADMIN'], mfa: true });
    await staffLogin(member.email, 'wrong password here');
    const { rows } = await t
      .app()
      .query<{ action: string; outcome: string; actor_type: string; metadata: { reason?: string } }>(
        `SELECT action, outcome, actor_type, metadata FROM identity.identity_audit_log
          WHERE subject_user_id = $1 AND action = 'LOGIN_FAILED'`,
        [member.userId],
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe('FAILURE');
  });
});
