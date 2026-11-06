// T-037, after security review: the self-action, staff-target, time-box, cap, denial-audit and
// approval rules that the main admin suite does not already walk. Skipped unless KOMTRU_INFRA_TESTS=1.
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { createTestRedis, redisReady } from '../support.js';
import {
  PASSWORD,
  bodyOf,
  buildApp,
  seedCatalogue,
  seedMember,
  staffSession,
  type Page,
  type Problem,
} from './staff.support.js';

interface Created {
  status?: string;
  approvalId?: string;
}
interface AuditRow {
  action: string;
  outcome: string;
  actor_type: string;
  metadata: Record<string, unknown> | null;
}

describe.runIf(infraEnabled)('admin hardening (T-037 review)', () => {
  const t = useTestDatabase();
  let redis: Redis;
  let app: Express;
  const REASON = 'checked against ticket 4471';

  beforeEach(async () => {
    redis ??= createTestRedis();
    await redisReady(redis);
    await seedCatalogue(t);
    app = buildApp(t, redis);
  });
  afterAll(() => {
    redis?.disconnect();
  });

  const staff = async (...roles: string[]) => {
    const member = await seedMember(t, app, { roles, mfa: true });
    return { ...member, token: await staffSession(app, member) };
  };
  const as = (token: string) => ({
    get: (path: string) => request(app).get(`/v1${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string, body: object = {}) =>
      request(app).post(`/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
  });
  const audit = async (where: string, params: unknown[] = []): Promise<AuditRow[]> =>
    (
      await t
        .owner()
        .query<AuditRow>(
          `SELECT action, outcome, actor_type, metadata FROM identity.identity_audit_log WHERE ${where} ORDER BY id`,
          params,
        )
    ).rows;

  describe('self-action', () => {
    it('stops a restricted admin lifting their own restriction, and records the refusal', async () => {
      const ops = await staff('OPERATIONS_ADMIN');
      await t.owner().query(`UPDATE identity.users SET status = 'RESTRICTED' WHERE id = $1`, [ops.userId]);
      const response = await as(ops.token).post(`/admin/users/${ops.userId}/status`, {
        status: 'ACTIVE',
        reason: REASON,
      });
      expect(response.status).toBe(403);
      const { rows } = await t
        .owner()
        .query<{ status: string }>(`SELECT status::text FROM identity.users WHERE id = $1`, [ops.userId]);
      expect(rows[0]?.status).toBe('RESTRICTED');
      const denied = await audit(`action = 'ADMIN_ACTION_DENIED' AND actor_user_id = $1`, [ops.userId]);
      expect(denied).toHaveLength(1);
      expect(denied[0]?.metadata).toMatchObject({ permission: 'user.reinstate', denied: 'SELF_ACTION' });
    });

    it('refuses a role granted to oneself with a DENIED row', async () => {
      const root = await staff('SUPER_ADMIN');
      const response = await as(root.token).post(`/admin/users/${root.userId}/roles`, {
        roleCode: 'KYC_ANALYST',
        reason: REASON,
      });
      expect(response.status).toBe(403);
      expect(
        await audit(`action = 'ADMIN_ACTION_DENIED' AND actor_user_id = $1`, [root.userId]),
      ).toHaveLength(1);
    });
  });

  describe('staff targets', () => {
    it('lets only a SUPER_ADMIN suspend, sign out or MFA-reset another staff member', async () => {
      const ops = await staff('OPERATIONS_ADMIN');
      const root = await staff('SUPER_ADMIN');
      const victim = await staff('KYC_ANALYST');

      for (const [path, body] of [
        [`/admin/users/${victim.userId}/status`, { status: 'SUSPENDED', reason: REASON }],
        [`/admin/users/${victim.userId}/sessions/revoke-all`, { reason: REASON }],
        [`/admin/users/${victim.userId}/mfa/reset/request`, { reason: REASON }],
      ] as const) {
        const refused = await as(ops.token).post(path, body);
        expect(refused.status, path).toBe(403);
      }
      const denied = await audit(`action = 'ADMIN_ACTION_DENIED' AND actor_user_id = $1`, [ops.userId]);
      expect(denied.map((row) => row.metadata?.denied)).toEqual([
        'STAFF_TARGET',
        'STAFF_TARGET',
        'STAFF_TARGET',
      ]);

      expect(
        (
          await as(root.token).post(`/admin/users/${victim.userId}/status`, {
            status: 'SUSPENDED',
            reason: REASON,
          })
        ).status,
      ).toBe(200);
    });

    it('lets only a SUPER_ADMIN approve an action aimed at staff', async () => {
      const root = await staff('SUPER_ADMIN');
      const lead = await staff('SUPPORT_LEAD');
      const ops = await staff('OPERATIONS_ADMIN');
      const victim = await staff('KYC_ANALYST');
      // Request by a SUPER_ADMIN (the only one allowed to ask), approval by a non-SUPER_ADMIN holder.
      const requested = await as(root.token).post(`/admin/users/${victim.userId}/mfa/reset/request`, {
        reason: REASON,
      });
      expect(requested.status).toBe(202);
      const { approvalId } = bodyOf<Created>(requested);
      const refused = await as(ops.token).post(`/admin/approvals/${approvalId}/approve`, {
        reason: REASON,
        identityChallengeRef: 'call-1',
      });
      expect(refused.status).toBe(403);
      expect(lead.userId).toBeTruthy();
    });
  });

  describe('approvals', () => {
    it('stops the subject approving or rejecting an approval aimed at them, and audits both', async () => {
      const ops = await staff('OPERATIONS_ADMIN');
      const subject = await staff('SUPPORT_LEAD');
      const { approvalId } = bodyOf<Created>(
        await (async () => {
          // SUPPORT_LEAD is staff, so a SUPER_ADMIN has to be the requester here.
          const root = await staff('SUPER_ADMIN');
          return as(root.token).post(`/admin/users/${subject.userId}/mfa/reset/request`, { reason: REASON });
        })(),
      );
      const approve = await as(subject.token).post(`/admin/approvals/${approvalId}/approve`, {
        reason: REASON,
        identityChallengeRef: 'call-9',
      });
      const reject = await as(subject.token).post(`/admin/approvals/${approvalId}/reject`, {
        reason: REASON,
      });
      expect(approve.status).toBe(403);
      expect(reject.status).toBe(403);
      const denied = await audit(`action = 'ADMIN_ACTION_DENIED' AND actor_user_id = $1`, [subject.userId]);
      expect(denied).toHaveLength(2);
      expect(denied.every((row) => row.outcome === 'DENIED')).toBe(true);
      expect(ops.userId).toBeTruthy();
    });

    it('records a DENIED row when an approval is refused', async () => {
      const ops = await staff('OPERATIONS_ADMIN');
      const lead = await staff('SUPPORT_LEAD');
      const target = await seedMember(t, app, { mfa: true });
      const { approvalId } = bodyOf<Created>(
        await as(ops.token).post(`/admin/users/${target.userId}/mfa/reset/request`, { reason: REASON }),
      );
      // No evidence reference: refused, and the refusal is kept.
      expect(
        (await as(lead.token).post(`/admin/approvals/${approvalId}/approve`, { reason: REASON })).status,
      ).toBe(403);
      const denied = await audit(`action = 'ADMIN_ACTION_DENIED' AND actor_user_id = $1`, [lead.userId]);
      expect(denied).toHaveLength(1);
      expect(denied[0]?.metadata).toMatchObject({ approvalId, decision: 'APPROVE' });
    });

    it('records the identity-challenge evidence reference in the audit row', async () => {
      const ops = await staff('OPERATIONS_ADMIN');
      const root = await staff('SUPER_ADMIN');
      const target = await seedMember(t, app, { mfa: true });
      const { approvalId } = bodyOf<Created>(
        await as(ops.token).post(`/admin/users/${target.userId}/mfa/reset/request`, { reason: REASON }),
      );
      expect(
        (
          await as(root.token).post(`/admin/approvals/${approvalId}/approve`, {
            reason: REASON,
            identityChallengeRef: 'TICKET-4471',
          })
        ).status,
      ).toBe(200);
      const rows = await audit(`action = 'APPROVAL_APPROVED' AND subject_user_id = $1`, [target.userId]);
      expect(rows[0]?.metadata).toMatchObject({ identityChallengeRef: 'TICKET-4471' });
    });

    it('lets exactly one of two concurrent approvals win', async () => {
      const ops = await staff('OPERATIONS_ADMIN');
      const root = await staff('SUPER_ADMIN');
      const second = await staff('SUPER_ADMIN');
      const target = await seedMember(t, app, { mfa: true });
      const { approvalId } = bodyOf<Created>(
        await as(ops.token).post(`/admin/users/${target.userId}/mfa/reset/request`, { reason: REASON }),
      );
      const approve = (token: string) =>
        as(token).post(`/admin/approvals/${approvalId}/approve`, {
          reason: REASON,
          identityChallengeRef: 'call-5',
        });
      const results = await Promise.all([approve(root.token), approve(second.token)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await audit(`action = 'APPROVAL_APPROVED' AND subject_user_id = $1`, [target.userId]),
      ).toHaveLength(1);
    });
  });

  describe('role grants', () => {
    it('time-boxes a grant with no expiry to a year, never to NULL', async () => {
      const root = await staff('SUPER_ADMIN');
      const target = await seedMember(t, app, { mfa: true });
      expect(
        (
          await as(root.token).post(`/admin/users/${target.userId}/roles`, {
            roleCode: 'KYC_ANALYST',
            reason: REASON,
          })
        ).status,
      ).toBe(201);
      const { rows } = await t
        .owner()
        .query<{ days: number }>(
          `SELECT extract(epoch FROM (expires_at - now())) / 86400 AS days FROM identity.admin_role_assignments WHERE user_id = $1`,
          [target.userId],
        );
      expect(Number(rows[0]?.days)).toBeGreaterThan(364);
      expect(Number(rows[0]?.days)).toBeLessThanOrEqual(365);
    });

    it('refuses a role for someone with no second factor', async () => {
      const root = await staff('SUPER_ADMIN');
      const bare = await seedMember(t, app);
      const response = await as(root.token).post(`/admin/users/${bare.userId}/roles`, {
        roleCode: 'KYC_ANALYST',
        reason: REASON,
      });
      expect(response.status).toBe(409);
      expect(
        (
          await t
            .owner()
            .query(`SELECT 1 FROM identity.admin_role_assignments WHERE user_id = $1`, [bare.userId])
        ).rowCount,
      ).toBe(0);
    });

    it('allows two SUPER_ADMIN holders and refuses a third, even through approval', async () => {
      const first = await staff('SUPER_ADMIN');
      const second = await staff('SUPER_ADMIN');
      const third = await seedMember(t, app, { mfa: true });
      const requested = await as(first.token).post(`/admin/users/${third.userId}/roles`, {
        roleCode: 'SUPER_ADMIN',
        reason: REASON,
      });
      expect(requested.status).toBe(201);
      const { approvalId } = bodyOf<Created>(requested);
      const approved = await as(second.token).post(`/admin/approvals/${approvalId}/approve`, {
        reason: REASON,
      });
      expect(approved.status).toBe(409);
      expect(bodyOf<Problem>(approved).code).toBe('CONFLICT');
      expect(
        (
          await t
            .owner()
            .query(`SELECT 1 FROM identity.admin_role_assignments WHERE role_code = 'SUPER_ADMIN'`)
        ).rowCount,
      ).toBe(2);
    });
  });

  describe('reads', () => {
    it('hides the status reason from roles that cannot see PII or act on status', async () => {
      const ro = await staff('READ_ONLY');
      const ops = await staff('OPERATIONS_ADMIN');
      const target = await seedMember(t, app);
      await t
        .owner()
        .query(`UPDATE identity.users SET status_reason = 'suspected mule account' WHERE id = $1`, [
          target.userId,
        ]);
      const seen = async (token: string) =>
        bodyOf<{ statusReason: string | null }>(
          await as(token).get(`/admin/users/${target.userId}?reason=${REASON}`),
        ).statusReason;
      expect(await seen(ro.token)).toBeNull();
      expect(await seen(ops.token)).toBe('suspected mule account');
    });

    it('takes the reason from X-Admin-Reason as well as the query', async () => {
      const ops = await staff('OPERATIONS_ADMIN');
      const target = await seedMember(t, app);
      const response = await request(app)
        .get(`/v1/admin/users/${target.userId}`)
        .set('Authorization', `Bearer ${ops.token}`)
        .set('X-Admin-Reason', 'looking into ticket 5');
      expect(response.status).toBe(200);
      const rows = await audit(`action = 'ADMIN_USER_VIEWED' AND subject_user_id = $1`, [target.userId]);
      expect(rows[0]?.metadata).toMatchObject({ reason: 'looking into ticket 5' });
    });

    it('gates linked accounts by risk.view, not session.view', async () => {
      const agent = await staff('SUPPORT_AGENT');
      const fraud = await staff('FRAUD_ANALYST');
      const target = await seedMember(t, app);
      expect(
        (await as(agent.token).get(`/admin/users/${target.userId}/linked-accounts?reason=${REASON}`)).status,
      ).toBe(403);
      expect(
        (await as(fraud.token).get(`/admin/users/${target.userId}/linked-accounts?reason=${REASON}`)).status,
      ).toBe(200);
    });

    it('ignores an IP link older than the window', async () => {
      const fraud = await staff('FRAUD_ANALYST');
      const a = await seedMember(t, app);
      const b = await seedMember(t, app);
      for (const [user, age] of [
        [a.userId, '1 hour'],
        [b.userId, '120 days'],
      ] as const)
        await t.owner().query(
          `INSERT INTO identity.sessions (user_id, family_id, refresh_token_hash, ip, absolute_expires_at, idle_expires_at, issued_at)
           VALUES ($1, gen_random_uuid(), decode(md5(random()::text || clock_timestamp()::text), 'hex'), '203.0.113.9', now() + interval '1 day', now() + interval '1 day', now() - $2::interval)`,
          [user, age],
        );
      const body = bodyOf<Page<{ userId: string; via: string }>>(
        await as(fraud.token).get(`/admin/users/${a.userId}/linked-accounts?reason=${REASON}`),
      );
      expect(body.items.filter((item) => item.userId === b.userId && item.via === 'IP')).toEqual([]);
    });
  });

  describe('staff login', () => {
    it('counts staff and consumer sign-in attempts against one per-identifier budget', async () => {
      const member = await seedMember(t, app, { roles: ['OPERATIONS_ADMIN'], mfa: true });
      for (let attempt = 0; attempt < 5; attempt += 1)
        await request(app)
          .post('/v1/auth/login')
          .send({ identifier: member.email, password: 'wrong password' });
      const staffLogin = await request(app)
        .post('/v1/auth/staff/login')
        .send({ identifier: member.email, password: PASSWORD });
      expect(staffLogin.status).toBe(429);
    });

    it('records the scope on a failed second factor', async () => {
      const member = await seedMember(t, app, { roles: ['OPERATIONS_ADMIN'], mfa: true });
      const challenge = bodyOf<{ mfaToken: string; factors: { id: string; type: string }[] }>(
        await request(app)
          .post('/v1/auth/staff/login')
          .send({ identifier: member.email, password: PASSWORD }),
      );
      await request(app)
        .post('/v1/auth/staff/mfa/verify')
        .send({
          mfaToken: challenge.mfaToken,
          factorId: challenge.factors.find((factor) => factor.type === 'TOTP')?.id,
          code: '000000',
        });
      const rows = await audit(`action = 'MFA_FAILED' AND subject_user_id = $1`, [member.userId]);
      expect(rows[0]?.metadata).toMatchObject({ scope: 'STAFF' });
    });
  });
});
