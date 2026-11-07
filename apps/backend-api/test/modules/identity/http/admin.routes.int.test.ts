// T-037: M1 section 10.6's admin surface end to end, through the real staff sign-in. Skipped unless
// KOMTRU_INFRA_TESTS=1.
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
  seedCatalogue,
  seedMember,
  staffSession,
  type Page,
  type Problem,
  type SessionBody,
} from './staff.support.js';

interface Created {
  assignmentId?: string;
  status?: string;
  approvalId?: string;
}
interface Decided {
  state: string;
  action: string;
}
interface AuditRow {
  action: string;
  outcome: string;
  actor_type: string;
  actor_user_id: string | null;
  subject_user_id: string | null;
  metadata: { reason?: string; [key: string]: unknown } | null;
}

describe.runIf(infraEnabled)('the admin surface (T-037, M1 section 10.6)', () => {
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

  /** A staff member holding `roles`, signed in with a STAFF session. */
  const staff = async (...roles: string[]) => {
    const member = await seedMember(t, app, { roles, mfa: true });
    const token = await staffSession(app, member);
    return { ...member, token };
  };

  const as = (token: string) => ({
    get: (path: string) => request(app).get(`/v1${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string, body: object = {}) =>
      request(app).post(`/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
    del: (path: string, body: object = {}) =>
      request(app).delete(`/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
  });

  /** A plain account with a verified email, a profile and a live consumer session. */
  const subject = async () => {
    const member = await seedMember(t, app);
    await t
      .owner()
      .query(`UPDATE identity.users SET username = $2::citext, username_skeleton = $2::text WHERE id = $1`, [
        member.userId,
        `user${member.userId.slice(0, 8)}`,
      ]);
    await t
      .owner()
      .query(
        `INSERT INTO identity.user_profiles (user_id, first_name, last_name) VALUES ($1, 'Ada', 'Obi')`,
        [member.userId],
      );
    const login = await request(app)
      .post('/v1/auth/login')
      .send({ identifier: member.email, password: PASSWORD });
    return { ...member, consumerToken: bodyOf<SessionBody>(login).accessToken };
  };

  /** A plain account with an enrolled second factor: the only kind a staff role may be granted to. */
  const mfaSubject = async () => seedMember(t, app, { mfa: true });

  const auditRows = async (where: string, params: unknown[] = []): Promise<AuditRow[]> =>
    (
      await t.owner().query<AuditRow>(
        `SELECT action, outcome, actor_type, actor_user_id, subject_user_id, metadata
             FROM identity.identity_audit_log WHERE ${where} ORDER BY id`,
        params,
      )
    ).rows;

  const REASON = 'checked against ticket 4471';

  describe('scope, permission and the mandatory reason', () => {
    it('refuses a consumer session and an anonymous caller', async () => {
      const target = await subject();
      expect((await as(target.consumerToken).get(`/admin/users?reason=${REASON}`)).status).toBe(403);
      expect((await request(app).get('/v1/admin/users?reason=x')).status).toBe(401);
    });

    it('refuses a staff role that lacks the permission, and records the denial', async () => {
      const analyst = await staff('ANALYST');
      const target = await subject();
      expect(
        (
          await as(analyst.token).post(`/admin/users/${target.userId}/roles`, {
            roleCode: 'KYC_ANALYST',
            reason: REASON,
          })
        ).status,
      ).toBe(403);
      expect(await auditRows(`action = 'ROLE_GRANTED'`)).toHaveLength(0);
      const denied = await auditRows(`action = 'ADMIN_ACTION_DENIED' AND actor_user_id = $1`, [
        analyst.userId,
      ]);
      expect(denied).toHaveLength(1);
      expect(denied[0]).toMatchObject({ outcome: 'DENIED', actor_type: 'STAFF' });
      expect(denied[0]?.metadata).toMatchObject({
        denied: 'ROUTE_PERMISSION',
        permission: 'role.grant',
        reason: REASON,
      });
    });

    it('answers 400 without a reason, on every admin endpoint, and records nothing', async () => {
      const admin = await staff('SUPER_ADMIN', 'OPERATIONS_ADMIN');
      const target = await subject();
      const id = target.userId;
      const before = (await auditRows(`actor_user_id = $1`, [admin.userId])).length;
      const calls: [string, () => request.Test][] = [
        ['GET users', () => as(admin.token).get('/admin/users')],
        ['GET user', () => as(admin.token).get(`/admin/users/${id}`)],
        ['GET pii', () => as(admin.token).get(`/admin/users/${id}/pii`)],
        ['POST status', () => as(admin.token).post(`/admin/users/${id}/status`, { status: 'RESTRICTED' })],
        ['POST revoke-all', () => as(admin.token).post(`/admin/users/${id}/sessions/revoke-all`)],
        ['GET audit-log', () => as(admin.token).get(`/admin/users/${id}/audit-log`)],
        ['GET linked', () => as(admin.token).get(`/admin/users/${id}/linked-accounts`)],
        ['POST roles', () => as(admin.token).post(`/admin/users/${id}/roles`, { roleCode: 'KYC_ANALYST' })],
        ['DELETE role', () => as(admin.token).del(`/admin/users/${id}/roles/KYC_ANALYST`)],
        [
          'POST reserve',
          () => as(admin.token).post('/admin/usernames/reserve', { username: 'acme', category: 'BRAND' }),
        ],
        ['POST mfa reset', () => as(admin.token).post(`/admin/users/${id}/mfa/reset/request`)],
        [
          'POST force-change',
          () =>
            as(admin.token).post(`/admin/users/${id}/username/force-change/request`, {
              newUsername: 'newname',
            }),
        ],
        ['GET approvals', () => as(admin.token).get('/admin/approvals')],
        [
          'approve',
          () => as(admin.token).post('/admin/approvals/0190a6e0-0000-7000-8000-000000000000/approve'),
        ],
        [
          'reject',
          () =>
            as(admin.token).post('/admin/approvals/0190a6e0-0000-7000-8000-000000000000/reject', {
              reason: '   ',
            }),
        ],
      ];
      for (const [name, call] of calls) {
        const response = await call();
        expect(response.status, name).toBe(400);
        expect(bodyOf<Problem>(response).code, name).toBe('VALIDATION_FAILED');
      }
      expect(await auditRows(`actor_user_id = $1`, [admin.userId])).toHaveLength(before);
    });
  });

  describe('reads', () => {
    it('searches and pages users without returning personal data, and audits the search', async () => {
      const ops = await staff('OPERATIONS_ADMIN');
      await subject();
      await subject();
      await subject();

      const first = await as(ops.token).get(`/admin/users?limit=2&page=1&reason=${REASON}`);
      expect(first.status).toBe(200);
      const page = bodyOf<Page<Record<string, unknown>>>(first);
      expect(page.items).toHaveLength(2);
      expect(page.total).toBeGreaterThanOrEqual(4);
      expect(JSON.stringify(page)).not.toMatch(/@example\.com|email|phone/i);

      const second = bodyOf<Page<{ id: string }>>(
        await as(ops.token).get(`/admin/users?limit=2&page=2&reason=${REASON}`),
      );
      expect(second.items.length).toBeGreaterThan(0);
      expect(second.items.map((u) => u.id)).not.toContain((page.items[0] as { id: string }).id);

      const rows = await auditRows(`action = 'ADMIN_USER_SEARCHED' AND actor_user_id = $1`, [ops.userId]);
      expect(rows).toHaveLength(2);
      expect(rows[0]?.actor_type).toBe('STAFF');
      expect(rows[0]?.metadata?.reason).toBe(REASON);
    });

    it('filters by status and matches a handle by prefix', async () => {
      const ops = await staff('OPERATIONS_ADMIN');
      const a = await subject();
      await t.owner().query(`UPDATE identity.users SET status = 'RESTRICTED' WHERE id = $1`, [a.userId]);
      const byStatus = bodyOf<Page<{ id: string }>>(
        await as(ops.token).get(`/admin/users?status=RESTRICTED&reason=${REASON}`),
      );
      expect(byStatus.items.map((u) => u.id)).toEqual([a.userId]);
      const byPrefix = bodyOf<Page<{ id: string }>>(
        await as(ops.token).get(`/admin/users?q=${`user${a.userId.slice(0, 8)}`}&reason=${REASON}`),
      );
      expect(byPrefix.items.map((u) => u.id)).toEqual([a.userId]);
    });

    it('shows one user without PII, 404s an unknown one, and audits the view', async () => {
      const ops = await staff('OPERATIONS_ADMIN');
      const target = await subject();
      const response = await as(ops.token).get(`/admin/users/${target.userId}?reason=${REASON}`);
      expect(response.status).toBe(200);
      expect(JSON.stringify(response.body)).not.toContain('example.com');
      expect(bodyOf<{ mfaEnrolled: boolean }>(response).mfaEnrolled).toBe(false);
      expect(
        (await as(ops.token).get(`/admin/users/0190a6e0-0000-7000-8000-000000000001?reason=${REASON}`))
          .status,
      ).toBe(404);
      expect(
        await auditRows(`action = 'ADMIN_USER_VIEWED' AND subject_user_id = $1`, [target.userId]),
      ).toHaveLength(1);
    });

    it('reveals PII with one audit row per field, and never writes a value into the log', async () => {
      const ops = await staff('OPERATIONS_ADMIN');
      const target = await subject();
      const response = await as(ops.token).get(`/admin/users/${target.userId}/pii?reason=${REASON}`);
      expect(response.status).toBe(200);
      expect(bodyOf<Record<string, string>>(response)).toMatchObject({
        email: target.email,
        firstName: 'Ada',
        lastName: 'Obi',
      });
      const rows = await auditRows(`action = 'ADMIN_PII_VIEWED' AND subject_user_id = $1`, [target.userId]);
      expect(rows.map((row) => row.metadata?.field).sort()).toEqual(['email', 'firstName', 'lastName']);
      expect(JSON.stringify(rows)).not.toContain(target.email);
    });

    it('refuses a support agent the PII until a ticket exists (footnote 1), and audits the refusal', async () => {
      const agent = await staff('SUPPORT_AGENT');
      const target = await subject();
      const response = await as(agent.token).get(`/admin/users/${target.userId}/pii?reason=${REASON}`);
      expect(response.status).toBe(403);
      const denied = await auditRows(`action = 'ADMIN_ACTION_DENIED' AND actor_user_id = $1`, [agent.userId]);
      expect(denied).toHaveLength(1);
      expect(denied[0]).toMatchObject({ outcome: 'DENIED' });
      expect(denied[0]?.metadata).toMatchObject({ permission: 'user.view_pii', denied: 'CONDITION_NOT_MET' });
      expect(await auditRows(`action = 'ADMIN_PII_VIEWED'`)).toHaveLength(0);
    });

    it('lists accounts sharing a device or an IP', async () => {
      const fraud = await staff('FRAUD_ANALYST');
      const a = await subject();
      const b = await subject();
      for (const user of [a, b])
        await t
          .owner()
          .query(
            `INSERT INTO identity.devices (user_id, device_fingerprint, platform) VALUES ($1, 'shared-handset', 'ios')`,
            [user.userId],
          );
      const response = await as(fraud.token).get(`/admin/users/${a.userId}/linked-accounts?reason=${REASON}`);
      expect(response.status).toBe(200);
      const body = bodyOf<Page<{ userId: string; via: string }>>(response);
      // Everyone in this suite signs in from one address, so the IP link shows up too; the device
      // link is the one under test and must be there exactly once for the other account.
      expect(body.items.filter((item) => item.via === 'DEVICE')).toEqual([
        expect.objectContaining({ userId: b.userId, via: 'DEVICE', shared: 1 }),
      ]);
      expect(body.items.every((item) => item.userId !== a.userId)).toBe(true);
      expect(body.total).toBe(body.items.length);
    });

    it('pages the audit log of a user, newest first, with the reasons staff gave', async () => {
      const ops = await staff('OPERATIONS_ADMIN');
      const target = await subject();
      await as(ops.token).get(`/admin/users/${target.userId}?reason=first`);
      await as(ops.token).get(`/admin/users/${target.userId}/pii?reason=second`);
      const log = bodyOf<Page<{ action: string; metadata: { reason?: string } }>>(
        await as(ops.token).get(`/admin/users/${target.userId}/audit-log?limit=100&reason=${REASON}`),
      );
      expect(log.items.map((row) => row.metadata?.reason)).toEqual(
        expect.arrayContaining(['first', 'second']),
      );
      expect(log.items[0]?.action).not.toBe('ADMIN_AUDIT_LOG_VIEWED');
      // The look at the log is itself recorded, after the read.
      expect(await auditRows(`action = 'ADMIN_AUDIT_LOG_VIEWED'`)).toHaveLength(1);
      const small = bodyOf<Page<unknown>>(
        await as(ops.token).get(`/admin/users/${target.userId}/audit-log?limit=1&reason=${REASON}`),
      );
      expect(small.items).toHaveLength(1);
    });
  });

  describe('status and sessions', () => {
    it('suspends: the status, the kill switch, the event and exactly one audit row', async () => {
      const ops = await staff('OPERATIONS_ADMIN');
      const target = await subject();
      const response = await as(ops.token).post(`/admin/users/${target.userId}/status`, {
        status: 'SUSPENDED',
        reason: REASON,
        evidenceRef: 'case-9',
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ from: 'ACTIVE', to: 'SUSPENDED' });

      // The consumer session died with it: the very next request is refused.
      expect((await as(target.consumerToken).get('/me/mfa/factors')).status).toBe(401);
      const { rows } = await t
        .owner()
        .query<{ status: string; sessions_epoch: number }>(
          `SELECT status::text, sessions_epoch FROM identity.users WHERE id = $1`,
          [target.userId],
        );
      expect(rows[0]).toMatchObject({ status: 'SUSPENDED' });
      expect(rows[0]?.sessions_epoch).toBeGreaterThan(1);
      const events = await t
        .owner()
        .query<{ event_type: string }>(
          `SELECT event_type FROM platform.outbox WHERE event_type = 'identity.user.status_changed'`,
        );
      expect(events.rows).toHaveLength(1);
      const audit = await auditRows(`action = 'ADMIN_STATUS_CHANGED' AND subject_user_id = $1`, [
        target.userId,
      ]);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.metadata).toMatchObject({
        reason: REASON,
        from: 'ACTIVE',
        to: 'SUSPENDED',
        evidenceRef: 'case-9',
      });
    });

    it('reinstates a suspended user, but not for a role without user.reinstate', async () => {
      const ops = await staff('OPERATIONS_ADMIN');
      const fraud = await staff('FRAUD_ANALYST');
      const target = await subject();
      await as(ops.token).post(`/admin/users/${target.userId}/status`, {
        status: 'SUSPENDED',
        reason: REASON,
      });
      expect(
        (
          await as(fraud.token).post(`/admin/users/${target.userId}/status`, {
            status: 'ACTIVE',
            reason: REASON,
          })
        ).status,
      ).toBe(403);
      const ok = await as(ops.token).post(`/admin/users/${target.userId}/status`, {
        status: 'ACTIVE',
        reason: REASON,
      });
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ from: 'SUSPENDED', to: 'ACTIVE' });
    });

    it('refuses a self-suspension, a transition the machine lacks, and the statuses T-039 owns', async () => {
      const ops = await staff('OPERATIONS_ADMIN');
      const target = await subject();
      const self = await as(ops.token).post(`/admin/users/${ops.userId}/status`, {
        status: 'SUSPENDED',
        reason: REASON,
      });
      expect(self.status).toBe(403);
      const same = await as(ops.token).post(`/admin/users/${target.userId}/status`, {
        status: 'ACTIVE',
        reason: REASON,
      });
      expect(same.status).toBe(409);
      expect(bodyOf<Problem>(same).code).toBe('INVALID_TRANSITION');
      // T-039 owns closing and it is now reachable, but this app is built with no trade port, which
      // fails closed: an unwired process refuses to close rather than closing blind.
      const closed = await as(ops.token).post(`/admin/users/${target.userId}/status`, {
        status: 'CLOSED',
        reason: REASON,
      });
      expect(closed.status).toBe(409);
      // Locking and anonymising stay out of staff's hands.
      for (const status of ['LOCKED', 'ANONYMISED']) {
        const refused = await as(ops.token).post(`/admin/users/${target.userId}/status`, {
          status,
          reason: REASON,
        });
        expect(refused.status, status).toBe(400);
      }
    });

    it('revokes every session of a user', async () => {
      const ops = await staff('OPERATIONS_ADMIN');
      const target = await subject();
      const response = await as(ops.token).post(`/admin/users/${target.userId}/sessions/revoke-all`, {
        reason: REASON,
      });
      expect(response.status).toBe(200);
      expect(bodyOf<{ revoked: number }>(response).revoked).toBeGreaterThanOrEqual(1);
      expect((await as(target.consumerToken).get('/me/mfa/factors')).status).toBe(401);
      expect(
        await auditRows(`action = 'ADMIN_SESSIONS_REVOKED' AND subject_user_id = $1`, [target.userId]),
      ).toHaveLength(1);
    });
  });

  describe('roles', () => {
    it('grants an ordinary role, time-boxed, with one audit row and an event', async () => {
      const root = await staff('SUPER_ADMIN');
      const target = await mfaSubject();
      const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const response = await as(root.token).post(`/admin/users/${target.userId}/roles`, {
        roleCode: 'KYC_ANALYST',
        reason: REASON,
        expiresAt,
      });
      expect(response.status).toBe(201);
      expect(bodyOf<Created>(response).status).toBe('GRANTED');
      const { rows } = await t
        .owner()
        .query<{ expires_at: Date; granted_by: string; approved_by: string | null }>(
          `SELECT expires_at, granted_by, approved_by FROM identity.admin_role_assignments WHERE user_id = $1`,
          [target.userId],
        );
      expect(rows[0]?.granted_by).toBe(root.userId);
      expect(rows[0]?.approved_by).toBeNull();
      expect(rows[0]?.expires_at.toISOString().slice(0, 16)).toBe(expiresAt.slice(0, 16));
      expect(
        await auditRows(`action = 'ROLE_GRANTED' AND subject_user_id = $1`, [target.userId]),
      ).toHaveLength(1);
      const events = await t
        .owner()
        .query(`SELECT 1 FROM platform.outbox WHERE event_type = 'identity.admin_role.granted'`);
      expect(events.rowCount).toBe(1);
    });

    it('refuses a past or over-long expiry, an unknown role, a duplicate and a self grant', async () => {
      const root = await staff('SUPER_ADMIN');
      const target = await mfaSubject();
      const grant = (body: object) =>
        as(root.token).post(`/admin/users/${target.userId}/roles`, { reason: REASON, ...body });
      expect(
        (await grant({ roleCode: 'KYC_ANALYST', expiresAt: new Date(Date.now() - 1000).toISOString() }))
          .status,
      ).toBe(400);
      expect(
        (
          await grant({
            roleCode: 'KYC_ANALYST',
            expiresAt: new Date(Date.now() + 400 * 86_400_000).toISOString(),
          })
        ).status,
      ).toBe(400);
      expect((await grant({ roleCode: 'NOT_A_ROLE' })).status).toBe(404);
      expect((await grant({ roleCode: 'KYC_ANALYST' })).status).toBe(201);
      expect((await grant({ roleCode: 'KYC_ANALYST' })).status).toBe(409);
      expect(
        (
          await as(root.token).post(`/admin/users/${root.userId}/roles`, {
            roleCode: 'KYC_ANALYST',
            reason: REASON,
          })
        ).status,
      ).toBe(403);
    });

    it('stops authorising an expired grant at expires_at with no job having run', async () => {
      const root = await staff('SUPER_ADMIN');
      const target = await staff('KYC_ANALYST');
      expect((await as(target.token).get(`/admin/users?reason=${REASON}`)).status).toBe(200);
      await t
        .owner()
        .query(
          `UPDATE identity.admin_role_assignments SET expires_at = now() - interval '1 second' WHERE user_id = $1`,
          [target.userId],
        );
      expect((await as(target.token).get(`/admin/users?reason=${REASON}`)).status).toBe(403);
      expect(root.userId).toBeTruthy();
    });

    it('opens an approval for a dual-approval role, and a second SUPER_ADMIN completes it', async () => {
      const first = await staff('SUPER_ADMIN');
      const second = await staff('SUPER_ADMIN');
      const target = await mfaSubject();

      const requested = await as(first.token).post(`/admin/users/${target.userId}/roles`, {
        roleCode: 'FINANCE_ADMIN',
        reason: REASON,
      });
      expect(requested.status).toBe(201);
      const { approvalId, status } = bodyOf<Created>(requested);
      expect(status).toBe('PENDING_APPROVAL');
      // Nothing is live yet, and the table could not hold it without an approver.
      expect(
        (
          await t
            .owner()
            .query(`SELECT 1 FROM identity.admin_role_assignments WHERE user_id = $1`, [target.userId])
        ).rowCount,
      ).toBe(0);

      const self = await as(first.token).post(`/admin/approvals/${approvalId}/approve`, { reason: REASON });
      expect(self.status).toBe(403);

      const done = await as(second.token).post(`/admin/approvals/${approvalId}/approve`, { reason: REASON });
      expect(done.status).toBe(200);
      expect(bodyOf<Decided>(done)).toMatchObject({ state: 'EXECUTED', action: 'ROLE_GRANT' });
      const { rows } = await t
        .owner()
        .query<{ granted_by: string; approved_by: string }>(
          `SELECT granted_by, approved_by FROM identity.admin_role_assignments WHERE user_id = $1 AND role_code = 'FINANCE_ADMIN'`,
          [target.userId],
        );
      expect(rows[0]).toEqual({ granted_by: first.userId, approved_by: second.userId });
      expect(
        (await as(second.token).post(`/admin/approvals/${approvalId}/approve`, { reason: REASON })).status,
      ).toBe(409);
    });

    it('refuses an approver who is the subject, and one who lacks role.grant', async () => {
      const root = await staff('SUPER_ADMIN');
      const ops = await staff('OPERATIONS_ADMIN');
      const target = await staff('KYC_ANALYST');
      const { approvalId } = bodyOf<Created>(
        await as(root.token).post(`/admin/users/${target.userId}/roles`, {
          roleCode: 'COMPLIANCE_OFFICER',
          reason: REASON,
        }),
      );
      expect(
        (await as(ops.token).post(`/admin/approvals/${approvalId}/approve`, { reason: REASON })).status,
      ).toBe(403);
      expect(
        (await as(target.token).post(`/admin/approvals/${approvalId}/approve`, { reason: REASON })).status,
      ).toBe(403);
    });

    it('revokes a role; COMPLIANCE_OFFICER may revoke but never grant; the last role ends STAFF sessions', async () => {
      const root = await staff('SUPER_ADMIN');
      const compliance = await staff('SUPER_ADMIN');
      // Compliance holds a dual-approval role in practice; here the permission under test is the grant.
      await t
        .owner()
        .query(`DELETE FROM identity.admin_role_assignments WHERE user_id = $1`, [compliance.userId]);
      await assignRole(t, compliance.userId, 'COMPLIANCE_OFFICER');
      const target = await staff('KYC_ANALYST');

      expect(
        (
          await as(compliance.token).post(`/admin/users/${target.userId}/roles`, {
            roleCode: 'KYC_ANALYST',
            reason: REASON,
          })
        ).status,
      ).toBe(403);

      const revoked = await as(compliance.token).del(`/admin/users/${target.userId}/roles/KYC_ANALYST`, {
        reason: REASON,
      });
      expect(revoked.status).toBe(200);
      expect(bodyOf<{ staffSessionsRevoked: number }>(revoked).staffSessionsRevoked).toBe(1);
      expect((await as(target.token).get(`/admin/users?reason=${REASON}`)).status).toBe(401);
      expect(
        (await as(root.token).del(`/admin/users/${target.userId}/roles/KYC_ANALYST`, { reason: REASON }))
          .status,
      ).toBe(404);
      expect(
        await auditRows(`action = 'ROLE_REVOKED' AND subject_user_id = $1`, [target.userId]),
      ).toHaveLength(1);
    });
  });

  describe('reserved handles', () => {
    it('reserves every fold of a handle, idempotently, with one audit row per call', async () => {
      const ops = await staff('OPERATIONS_ADMIN');
      const reserve = () =>
        as(ops.token).post('/admin/usernames/reserve', {
          username: '@AcmePay',
          category: 'BRAND',
          note: 'brand',
          reason: REASON,
        });
      const first = await reserve();
      expect(first.status).toBe(201);
      expect(bodyOf<{ username: string }>(first).username).toBe('acmepay');
      const count = (await t.owner().query(`SELECT 1 FROM identity.reserved_usernames WHERE note = 'brand'`))
        .rowCount;
      expect(count).toBeGreaterThan(0);
      expect((await reserve()).status).toBe(201);
      expect(
        (await t.owner().query(`SELECT 1 FROM identity.reserved_usernames WHERE note = 'brand'`)).rowCount,
      ).toBe(count);
      expect(await auditRows(`action = 'USERNAME_RESERVED'`)).toHaveLength(2);
    });
  });

  describe('two-step actions', () => {
    it('resets MFA only after a different holder approves with the identity challenge attested', async () => {
      const ops = await staff('OPERATIONS_ADMIN');
      const lead = await staff('SUPPORT_LEAD');
      const root = await staff('SUPER_ADMIN');
      const target = await seedMember(t, app, { mfa: true });
      const targetSession = bodyOf<SessionBody>(
        await request(app).post('/v1/auth/login').send({ identifier: target.email, password: PASSWORD }),
      );
      expect(targetSession.accessToken).toBeUndefined();

      const requested = await as(ops.token).post(`/admin/users/${target.userId}/mfa/reset/request`, {
        reason: REASON,
      });
      expect(requested.status).toBe(202);
      const { approvalId } = bodyOf<Created>(requested);

      // Nothing has happened.
      expect(
        (
          await t
            .owner()
            .query(`SELECT 1 FROM identity.mfa_factors WHERE user_id = $1 AND revoked_at IS NULL`, [
              target.userId,
            ])
        ).rowCount,
      ).toBeGreaterThan(0);

      // The requester cannot approve their own request; nor can anyone without the challenge.
      expect(
        (
          await as(ops.token).post(`/admin/approvals/${approvalId}/approve`, {
            reason: REASON,
            identityChallengeRef: 'call-2231',
          })
        ).status,
      ).toBe(403);
      expect(
        (await as(lead.token).post(`/admin/approvals/${approvalId}/approve`, { reason: REASON })).status,
      ).toBe(403);
      expect(
        (
          await t
            .owner()
            .query(`SELECT 1 FROM identity.mfa_factors WHERE user_id = $1 AND revoked_at IS NULL`, [
              target.userId,
            ])
        ).rowCount,
      ).toBeGreaterThan(0);

      const done = await as(root.token).post(`/admin/approvals/${approvalId}/approve`, {
        reason: REASON,
        identityChallengeRef: 'call-2231',
      });
      expect(done.status).toBe(200);
      expect(bodyOf<Decided>(done)).toMatchObject({ state: 'EXECUTED', action: 'MFA_RESET' });
      expect(
        (
          await t
            .owner()
            .query(`SELECT 1 FROM identity.mfa_factors WHERE user_id = $1 AND revoked_at IS NULL`, [
              target.userId,
            ])
        ).rowCount,
      ).toBe(0);
      const row = (
        await t
          .owner()
          .query<{ approved_by: string; executed_at: Date | null }>(
            `SELECT approved_by, executed_at FROM identity.admin_action_approvals WHERE id = $1`,
            [approvalId],
          )
      ).rows[0];
      expect(row?.approved_by).toBe(root.userId);
      expect(row?.executed_at).not.toBeNull();
      // One row for the request, one for the approve-and-execute, each with its reason.
      const rows = await auditRows(`subject_user_id = $1 AND action LIKE 'APPROVAL_%'`, [target.userId]);
      expect(rows.map((r) => r.action)).toEqual(['APPROVAL_REQUESTED', 'APPROVAL_APPROVED']);
      expect(rows.every((r) => (r.metadata?.reason ?? '').length > 0)).toBe(true);
      // Spent: a second approval is a conflict, not a second reset.
      expect(
        (
          await as(root.token).post(`/admin/approvals/${approvalId}/approve`, {
            reason: REASON,
            identityChallengeRef: 'call-2231',
          })
        ).status,
      ).toBe(409);
    });

    it('refuses an MFA reset request from a role that does not hold mfa.reset, and one aimed at oneself', async () => {
      const fraud = await staff('FRAUD_ANALYST');
      const ops = await staff('OPERATIONS_ADMIN');
      const target = await subject();
      expect(
        (await as(fraud.token).post(`/admin/users/${target.userId}/mfa/reset/request`, { reason: REASON }))
          .status,
      ).toBe(403);
      expect(
        (await as(ops.token).post(`/admin/users/${ops.userId}/mfa/reset/request`, { reason: REASON })).status,
      ).toBe(403);
    });

    it('forces a handle change only after approval, then runs it', async () => {
      const fraud = await staff('FRAUD_ANALYST');
      const ops = await staff('OPERATIONS_ADMIN');
      const target = await subject();
      const requested = await as(fraud.token).post(
        `/admin/users/${target.userId}/username/force-change/request`,
        {
          newUsername: 'renamed_by_staff',
          reason: REASON,
          evidenceRef: 'case-12',
        },
      );
      expect(requested.status).toBe(202);
      const { approvalId } = bodyOf<Created>(requested);

      const username = async () =>
        (
          await t
            .owner()
            .query<{ username: string }>(`SELECT username::text FROM identity.users WHERE id = $1`, [
              target.userId,
            ])
        ).rows[0]?.username;
      const before = await username();
      expect(before).not.toBe('renamed_by_staff');

      expect(
        (await as(fraud.token).post(`/admin/approvals/${approvalId}/approve`, { reason: REASON })).status,
      ).toBe(403);
      expect(await username()).toBe(before);

      const done = await as(ops.token).post(`/admin/approvals/${approvalId}/approve`, { reason: REASON });
      expect(done.status).toBe(200);
      expect(await username()).toBe('renamed_by_staff');
      const events = await t
        .owner()
        .query(`SELECT 1 FROM platform.outbox WHERE event_type = 'identity.username.changed'`);
      expect(events.rowCount).toBe(1);
    });

    it('rejects a request, and a rejected request can no longer be approved', async () => {
      const ops = await staff('OPERATIONS_ADMIN');
      const lead = await staff('SUPPORT_LEAD');
      const target = await subject();
      const { approvalId } = bodyOf<Created>(
        await as(ops.token).post(`/admin/users/${target.userId}/mfa/reset/request`, { reason: REASON }),
      );
      const rejected = await as(lead.token).post(`/admin/approvals/${approvalId}/reject`, {
        reason: 'not verified',
      });
      expect(rejected.status).toBe(200);
      expect(bodyOf<Decided>(rejected).state).toBe('REJECTED');
      expect(
        (
          await as(lead.token).post(`/admin/approvals/${approvalId}/approve`, {
            reason: REASON,
            identityChallengeRef: 'call-2231',
          })
        ).status,
      ).toBe(409);
    });

    it('lists approvals by state, showing each caller only the actions they hold', async () => {
      const ops = await staff('OPERATIONS_ADMIN');
      const finance = await staff('SUPER_ADMIN');
      await t
        .owner()
        .query(`DELETE FROM identity.admin_role_assignments WHERE user_id = $1`, [finance.userId]);
      await assignRole(t, finance.userId, 'FINANCE_ADMIN');
      const target = await subject();
      await as(ops.token).post(`/admin/users/${target.userId}/mfa/reset/request`, { reason: REASON });

      const mine = bodyOf<Page<{ action: string; state: string }>>(
        await as(ops.token).get(`/admin/approvals?status=PENDING&reason=${REASON}`),
      );
      expect(mine.items).toEqual([expect.objectContaining({ action: 'MFA_RESET', state: 'PENDING' })]);
      expect(mine.total).toBe(1);
      const theirs = bodyOf<Page<unknown>>(await as(finance.token).get(`/admin/approvals?reason=${REASON}`));
      expect(theirs.items).toEqual([]);
      expect(
        bodyOf<Page<unknown>>(await as(ops.token).get(`/admin/approvals?status=EXECUTED&reason=${REASON}`))
          .items,
      ).toEqual([]);
    });
  });
});
