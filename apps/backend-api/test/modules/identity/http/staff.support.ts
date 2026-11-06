// Shared setup for T-037's integration tests: the identity app, real catalogue rows, and staff
// members who sign in through the real routes (password, then TOTP) so every admin test holds a
// genuine STAFF session rather than a hand-built token.
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { expect } from 'vitest';
import { createApp } from '../../../../src/app.js';
import { createIdentityAuth, seedIdentityCatalogue } from '../../../../src/modules/identity/index.js';
import { totpCodeAt, totpStep } from '../../../../src/modules/identity/domain/mfa/totp.js';
import { attachEmail, markEmailVerified } from '../../../../src/modules/identity/services/contact.service.js';
import { setPassword } from '../../../../src/modules/identity/services/credential.service.js';
import { createIdempotencyGate } from '../../../../src/platform/http/idempotency.js';
import { mountRoutes } from '../../../../src/platform/http/mount.js';
import { createRateLimitGate } from '../../../../src/platform/http/rateLimit.js';
import type { TestDatabase } from '../../../support/db.js';
import { mfaDeps, seedUser, testConfig, testLogger } from '../support.js';

export const PASSWORD = 'a sturdy passphrase 1';

/** supertest types `response.body` as `any`; every read goes through `bodyOf`. */
export const bodyOf = <T>(response: { body: unknown }): T => response.body as T;

export interface Problem {
  code: string;
  title?: string;
  detail?: string;
  errors?: { path: string; message: string }[];
}
export interface Page<T> {
  items: T[];
  total?: number;
  page?: number;
  limit?: number;
}
export interface SessionBody {
  accessToken: string;
  refreshToken: string;
  scope: string;
}
export interface ChallengeBody {
  mfaRequired: true;
  mfaToken: string;
  factors: { id: string; type: string }[];
}

export const buildApp = (t: TestDatabase, redis: Redis): Express => {
  const config = testConfig({ WEBAUTHN_ORIGINS: 'https://app.komtru.test' });
  const auth = createIdentityAuth({ db: t.db(), redis, config, logger: testLogger });
  return createApp({
    config,
    logger: testLogger,
    mountV1: mountRoutes(auth.routes ?? [], {
      logger: testLogger,
      idempotency: createIdempotencyGate({ db: t.db(), redis, logger: testLogger }),
      rateLimit: createRateLimitGate({ redis, logger: testLogger, keyPrefix: `rl-${randomUUID()}` }),
      resolveActor: auth.resolveActor,
    }),
  });
};

/** Call after the per-test truncate: the catalogue is reference data the truncate removes. */
export const seedCatalogue = (t: TestDatabase) => seedIdentityCatalogue(t.db());

/** A live role grant, with a distinct grantor and (for dual-approval roles) approver. */
export async function assignRole(
  t: TestDatabase,
  userId: string,
  roleCode: string,
  { expiresAt = null as Date | null, approved = true } = {},
): Promise<string> {
  const { userId: grantor } = await seedUser(t.app());
  const { userId: approver } = await seedUser(t.app());
  const { rows } = await t.app().query<{ id: string }>(
    `INSERT INTO identity.admin_role_assignments
       (user_id, role_code, granted_by, approved_by, reason, expires_at)
     VALUES ($1, $2, $3, $4, 'test grant', $5) RETURNING id`,
    [userId, roleCode, grantor, approved ? approver : null, expiresAt],
  );
  return rows[0]?.id ?? '';
}

export interface Member {
  userId: string;
  email: string;
  /** Present only when MFA was enrolled. */
  secret?: string;
  factorId?: string;
  /** TOTP steps already spent, so each sign-in presents a strictly newer one. */
  nextOffset: number;
}

let counter = 0;

/**
 * A user with a verified email and a password. With `mfa`, a TOTP factor too — enrolled over HTTP
 * through a consumer session, because the app's own encryption key must hold the seed. `roles` are
 * live grants. Activation spends step-1, leaving the current step and step+1 for two sign-ins.
 */
export async function seedMember(
  t: TestDatabase,
  app: Express,
  { roles = [] as string[], mfa = false } = {},
): Promise<Member> {
  counter += 1;
  const email = `member${counter}-${randomUUID().slice(0, 8)}@example.com`;
  const { userId } = await seedUser(t.app());
  await t.db().transaction(async (tx) => {
    const attached = await attachEmail(tx, { userId, email, makePrimary: true });
    await markEmailVerified(tx, { userId, emailId: attached.emailId, source: 'otp' });
    await setPassword(tx, mfaDeps(), { userId, password: PASSWORD });
  });

  const member: Member = { userId, email, nextOffset: 0 };
  if (mfa) {
    const login = await request(app).post('/v1/auth/login').send({ identifier: email, password: PASSWORD });
    expect(login.status).toBe(200);
    const token = bodyOf<SessionBody>(login).accessToken;
    const enrolled = await request(app)
      .post('/v1/me/mfa/totp/enroll')
      .set('Authorization', `Bearer ${token}`);
    expect(enrolled.status).toBe(200);
    const { factorId, secret } = bodyOf<{ factorId: string; secret: string }>(enrolled);
    const activated = await request(app)
      .post('/v1/me/mfa/totp/activate')
      .set('Authorization', `Bearer ${token}`)
      .send({ factorId, code: totpCodeAt(secret, totpStep(Date.now()) - 1) });
    expect(activated.status).toBe(200);
    member.secret = secret;
    member.factorId = factorId;
  }
  for (const role of roles) await assignRole(t, userId, role);
  return member;
}

const nextCode = (member: Member): string => {
  if (!member.secret) throw new Error('member has no TOTP secret');
  const code = totpCodeAt(member.secret, totpStep(Date.now()) + member.nextOffset);
  member.nextOffset += 1;
  return code;
};

/** Password then TOTP: the whole staff sign-in. Returns the STAFF session's access token. */
export async function staffSession(app: Express, member: Member): Promise<string> {
  const first = await request(app)
    .post('/v1/auth/staff/login')
    .send({ identifier: member.email, password: PASSWORD });
  expect(first.status).toBe(200);
  const challenge = bodyOf<ChallengeBody>(first);
  const totp = challenge.factors.find((factor) => factor.type === 'TOTP');
  const second = await request(app)
    .post('/v1/auth/staff/mfa/verify')
    .send({ mfaToken: challenge.mfaToken, factorId: totp?.id, code: nextCode(member) });
  expect(second.status).toBe(200);
  expect(bodyOf<SessionBody>(second).scope).toBe('STAFF');
  return bodyOf<SessionBody>(second).accessToken;
}

export { nextCode };
