// F-065: the logistics sign-in's edges. An mfaToken is bound to the scope it was issued for, a person
// with invitations from two companies is refused rather than guessed at, and a right password with no
// membership is an audited refusal that does not count as a failed login. Skipped unless
// KOMTRU_INFRA_TESTS=1.
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { login } from '../../../src/modules/identity/services/login.service.js';
import { acceptOnLogin, hasLogisticsAccess } from '../../../src/modules/logistics/index.js';
import { totpCodeAt, totpStep } from '../../../src/modules/identity/domain/mfa/totp.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { createTestRedis, mfaDeps, redisReady } from '../identity/support.js';
import {
  PASSWORD,
  bodyOf,
  seedCatalogue,
  seedMember,
  type ChallengeBody,
  type Member,
  type Problem,
  type SessionBody,
} from '../identity/http/staff.support.js';
import { buildLogisticsApp, insertCompany, insertMember, logisticsLogin, memberStatus } from './support.js';

describe.runIf(infraEnabled)('logistics sign-in edges (F-065)', () => {
  const t = useTestDatabase();
  let redis: Redis;
  let app: Express;

  beforeEach(async () => {
    redis ??= createTestRedis();
    await redisReady(redis);
    await seedCatalogue(t);
    app = buildLogisticsApp(t, redis).app;
  });
  afterAll(() => {
    redis?.disconnect();
  });

  const sessionCount = async (userId: string): Promise<number> =>
    (await t.app().query(`SELECT 1 FROM identity.sessions WHERE user_id = $1`, [userId])).rowCount ?? 0;

  describe('an mfaToken belongs to the scope that issued it', () => {
    /** One TOTP code for the current step, reusable across the wrong door and the right one. */
    const codeFor = (member: Member): string => totpCodeAt(member.secret ?? '', totpStep(Date.now()) + 1);

    const challenge = async (path: string, member: Member): Promise<ChallengeBody> => {
      const response = await request(app).post(path).send({ identifier: member.email, password: PASSWORD });
      expect(response.status).toBe(200);
      const body = bodyOf<ChallengeBody>(response);
      expect(body.mfaRequired).toBe(true);
      return body;
    };

    const verify = (path: string, token: string, member: Member, factorId: string) =>
      request(app)
        .post(path)
        .send({ mfaToken: token, factorId, code: codeFor(member) });

    async function memberWithEverything(): Promise<{ member: Member; companyId: string }> {
      const member = await seedMember(t, app, { roles: ['OPERATIONS_ADMIN'], mfa: true });
      const companyId = await insertCompany(t, 'Swift Couriers');
      await insertMember(t, { companyId, userId: member.userId, role: 'ADMIN', status: 'ACTIVE' });
      return { member, companyId };
    }

    it('refuses a CONSUMER mfaToken at the logistics door, and it still works at its own', async () => {
      const { member } = await memberWithEverything();
      const issued = await challenge('/v1/auth/login', member);
      const factorId = issued.factors[0]!.id;

      const wrong = await verify('/v1/auth/logistics/mfa/verify', issued.mfaToken, member, factorId);
      expect(wrong.status).toBe(401);
      expect(bodyOf<SessionBody>(wrong).accessToken).toBeUndefined();
      expect(await sessionCount(member.userId)).toBe(1); // the sign-in used to enrol, nothing new

      const right = await verify('/v1/auth/mfa/verify', issued.mfaToken, member, factorId);
      expect(right.status).toBe(200);
      expect(bodyOf<SessionBody>(right).scope).toBe('CONSUMER');
    });

    it('refuses a LOGISTICS mfaToken at the staff door, and it still works at its own', async () => {
      const { member } = await memberWithEverything();
      const issued = await challenge('/v1/auth/logistics/login', member);
      const factorId = issued.factors[0]!.id;

      const wrong = await verify('/v1/auth/staff/mfa/verify', issued.mfaToken, member, factorId);
      expect(wrong.status).toBe(401);
      expect(bodyOf<SessionBody>(wrong).accessToken).toBeUndefined();

      const consumerDoor = await verify('/v1/auth/mfa/verify', issued.mfaToken, member, factorId);
      expect(consumerDoor.status).toBe(401);

      const right = await verify('/v1/auth/logistics/mfa/verify', issued.mfaToken, member, factorId);
      expect(right.status).toBe(200);
      expect(bodyOf<SessionBody>(right).scope).toBe('LOGISTICS');
    });

    it('refuses a STAFF mfaToken at the logistics door, and it still works at its own', async () => {
      const { member } = await memberWithEverything();
      const issued = await challenge('/v1/auth/staff/login', member);
      const factorId = issued.factors[0]!.id;

      const wrong = await verify('/v1/auth/logistics/mfa/verify', issued.mfaToken, member, factorId);
      expect(wrong.status).toBe(401);
      expect(bodyOf<SessionBody>(wrong).accessToken).toBeUndefined();

      const right = await verify('/v1/auth/staff/mfa/verify', issued.mfaToken, member, factorId);
      expect(right.status).toBe(200);
      expect(bodyOf<SessionBody>(right).scope).toBe('STAFF');
    });
  });

  describe('several invitations', () => {
    it('answers 409 MULTIPLE_LOGISTICS_INVITATIONS every time, and activates neither row', async () => {
      const person = await seedMember(t, app);
      const a = await insertMember(t, {
        companyId: await insertCompany(t, 'Courier A'),
        userId: person.userId,
        role: 'OPERATOR',
      });
      const b = await insertMember(t, {
        companyId: await insertCompany(t, 'Courier B'),
        userId: person.userId,
        role: 'ADMIN',
      });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await logisticsLogin(app, person.email);
        expect(response.status).toBe(409);
        expect(bodyOf<Problem>(response).code).toBe('MULTIPLE_LOGISTICS_INVITATIONS');
        expect(await memberStatus(t, a)).toBe('INVITED');
        expect(await memberStatus(t, b)).toBe('INVITED');
      }
      const { rows } = await t
        .app()
        .query(`SELECT 1 FROM logistics.logistics_company_members WHERE user_id = $1 AND status = 'ACTIVE'`, [
          person.userId,
        ]);
      expect(rows).toHaveLength(0);
      expect(await sessionCount(person.userId)).toBe(0);
    });

    it('still opens a consumer session for the same person', async () => {
      const person = await seedMember(t, app);
      await insertMember(t, { companyId: await insertCompany(t, 'Courier A'), userId: person.userId });
      await insertMember(t, { companyId: await insertCompany(t, 'Courier B'), userId: person.userId });
      const consumer = await request(app)
        .post('/v1/auth/login')
        .send({ identifier: person.email, password: PASSWORD });
      expect(consumer.status).toBe(200);
    });
  });

  describe('a refusal after the password was proved', () => {
    const failedAttempts = async (userId: string): Promise<number> =>
      (
        await t
          .app()
          .query<{ n: number }>(
            `SELECT failed_attempts AS n FROM identity.user_credentials WHERE user_id = $1`,
            [userId],
          )
      ).rows[0]?.n ?? -1;

    const auditActions = async (
      userId: string,
    ): Promise<{ action: string; outcome: string; metadata: unknown }[]> =>
      (
        await t.app().query<{ action: string; outcome: string; metadata: unknown }>(
          `SELECT action, outcome, metadata FROM identity.identity_audit_log
              WHERE subject_user_id = $1 ORDER BY id`,
          [userId],
        )
      ).rows;

    const outboxTypes = async (): Promise<string[]> =>
      (
        await t.app().query<{ event_type: string }>(`SELECT event_type FROM platform.outbox ORDER BY seq`)
      ).rows.map((row) => row.event_type);

    it('writes LOGIN_REFUSED, no identity.login.failed event, and does not grow the lockout counter', async () => {
      const person = await seedMember(t, app);
      const eventsBefore = (await outboxTypes()).filter((type) => type === 'identity.login.failed');
      const counterBefore = await failedAttempts(person.userId);
      expect(counterBefore).toBe(0);

      // The route's own rate limit (5 a minute per identifier) stops the HTTP loop short of the lockout
      // threshold, so the threshold itself is crossed through the service below.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await logisticsLogin(app, person.email);
        expect(response.status).toBe(403);
        expect(bodyOf<Problem>(response).code).toBe('NO_LOGISTICS_ACCESS');
      }

      const rows = await auditActions(person.userId);
      const refused = rows.filter((row) => row.action === 'LOGIN_REFUSED');
      expect(refused).toHaveLength(4);
      for (const row of refused) {
        expect(row.outcome).toBe('FAILURE');
        expect(row.metadata).toMatchObject({
          scope: 'LOGISTICS',
          reason: 'no_logistics_access',
          stage: 'password',
        });
      }
      expect(rows.some((row) => row.action === 'LOGIN_FAILED')).toBe(false);

      expect((await outboxTypes()).filter((type) => type === 'identity.login.failed')).toEqual(eventsBefore);
      expect(await failedAttempts(person.userId)).toBe(counterBefore);
      const { rows: locked } = await t
        .app()
        .query(`SELECT 1 FROM identity.user_credentials WHERE user_id = $1 AND locked_until IS NOT NULL`, [
          person.userId,
        ]);
      expect(locked).toHaveLength(0);

      // Nothing locked them out of anything: the consumer door still takes the password.
      const consumer = await request(app)
        .post('/v1/auth/login')
        .send({ identifier: person.email, password: PASSWORD });
      expect(consumer.status).toBe(200);
    }, 60_000);

    it('stays unlocked past the lockout threshold when the refusals come through the service', async () => {
      const person = await seedMember(t, app);
      const deps = mfaDeps({ logisticsAccess: { eligible: hasLogisticsAccess, accept: acceptOnLogin } });
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const result = await login(
          t.db(),
          deps,
          { identifier: person.email, password: PASSWORD, ip: '203.0.113.9', userAgent: 'vitest' },
          { scope: 'LOGISTICS' },
        );
        expect(result.outcome).toBe('NO_LOGISTICS_ACCESS');
      }
      expect(await failedAttempts(person.userId)).toBe(0);
      const { rows } = await t
        .app()
        .query(`SELECT 1 FROM identity.user_credentials WHERE user_id = $1 AND locked_until IS NOT NULL`, [
          person.userId,
        ]);
      expect(rows).toHaveLength(0);
      expect(
        (await auditActions(person.userId)).filter((row) => row.action === 'LOGIN_REFUSED'),
      ).toHaveLength(12);
      expect(await outboxTypes()).not.toContain('identity.login.failed');
    }, 60_000);

    it('does charge a wrong password at the logistics door, so the counter above is meaningful', async () => {
      const person = await seedMember(t, app);
      const response = await logisticsLogin(app, person.email, 'definitely not the password');
      expect(response.status).toBe(401);
      expect(await failedAttempts(person.userId)).toBe(1);
      expect((await outboxTypes()).filter((type) => type === 'identity.login.failed')).toHaveLength(1);
      expect((await auditActions(person.userId)).some((row) => row.action === 'LOGIN_FAILED')).toBe(true);
    });
  });
});
