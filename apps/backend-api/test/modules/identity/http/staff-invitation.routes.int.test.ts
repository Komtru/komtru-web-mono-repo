// T-038 end to end through the real routes: a SUPER_ADMIN's staff session writes the invitation, the
// invitee's consumer session accepts it. Skipped unless KOMTRU_INFRA_TESTS=1.
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
  nextCode,
  seedCatalogue,
  seedMember,
  staffSession,
  type ChallengeBody,
  type Member,
  type Page,
  type Problem,
  type SessionBody,
} from './staff.support.js';

interface Created {
  invitationId: string;
  token: string;
  maskedDestination: string;
  expiresAt: string;
}
interface Started {
  challengeId: string;
}
interface Accepted {
  status: string;
  roleCode: string;
  assignmentId?: string;
  approvalId?: string;
}
interface View {
  id: string;
  status: string;
  maskedDestination: string;
  roleCode: string;
}

const REASON = 'onboarding a KYC analyst, ticket 5120';

describe.runIf(infraEnabled)('staff invitations over HTTP (T-038)', () => {
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

  const as = (token: string) => ({
    get: (path: string) => request(app).get(`/v1${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string, body: object = {}) =>
      request(app).post(`/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
    del: (path: string, body: object = {}) =>
      request(app).delete(`/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
  });

  const staff = async (...roles: string[]) => {
    const member = await seedMember(t, app, { roles, mfa: true });
    return { ...member, token: await staffSession(app, member) };
  };

  /** A plain account with a second factor, signed in as a CONSUMER (password, then TOTP). */
  const person = async (): Promise<Member & { token: string }> => {
    const member = await seedMember(t, app, { mfa: true });
    const first = await request(app)
      .post('/v1/auth/login')
      .send({ identifier: member.email, password: PASSWORD });
    const challenge = bodyOf<ChallengeBody>(first);
    const totp = challenge.factors.find((factor) => factor.type === 'TOTP');
    const second = await request(app)
      .post('/v1/auth/mfa/verify')
      .send({ mfaToken: challenge.mfaToken, factorId: totp?.id, code: nextCode(member) });
    expect(second.status).toBe(200);
    return { ...member, token: bodyOf<SessionBody>(second).accessToken };
  };

  const codeFor = async (challengeId: string): Promise<string> => {
    const { rows } = await t
      .app()
      .query<{ payload: { challengeId: string; code: string } }>(
        `SELECT payload FROM platform.outbox WHERE event_type = 'identity.otp.requested' ORDER BY occurred_at`,
      );
    const match = rows.map((r) => r.payload).find((p) => p.challengeId === challengeId);
    if (!match) throw new Error(`no code for ${challengeId}`);
    return match.code;
  };

  const liveRoles = async (userId: string): Promise<string[]> =>
    (
      await t
        .owner()
        .query<{ role_code: string }>(
          `SELECT role_code FROM identity.admin_role_assignments WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId],
        )
    ).rows.map((r) => r.role_code);

  const invite = (admin: { token: string }, email: string, roleCode = 'KYC_ANALYST') =>
    as(admin.token).post('/admin/staff-invitations', { email, roleCode, reason: REASON });

  describe('the admin routes', () => {
    it('creates an invitation with 201 and returns the token once, with a masked address', async () => {
      const admin = await staff('SUPER_ADMIN');
      const response = await invite(admin, 'Ada.Obi@example.com');

      expect(response.status).toBe(201);
      const body = bodyOf<Created>(response);
      expect(body.token.length).toBeGreaterThanOrEqual(20);
      expect(body.maskedDestination).not.toContain('Ada.Obi');

      // Nothing downstream repeats it: the list shows the mask and never a token or a hash.
      const listed = await as(admin.token).get(`/admin/staff-invitations?reason=${REASON}`);
      expect(listed.status).toBe(200);
      const text = JSON.stringify(listed.body);
      expect(text).not.toContain(body.token);
      expect(text).not.toContain('token');
      expect(text).not.toContain('ada.obi');
      expect(bodyOf<Page<View>>(listed).items).toHaveLength(1);
    });

    it('is SUPER_ADMIN only on all three routes, recording the denial', async () => {
      const ops = await staff('OPERATIONS_ADMIN');
      const created = await invite(ops, 'x@example.com');
      expect(created.status).toBe(403);
      expect((await as(ops.token).get(`/admin/staff-invitations?reason=${REASON}`)).status).toBe(403);
      expect(
        (
          await as(ops.token).del('/admin/staff-invitations/0190a6e0-0000-7000-8000-000000000000', {
            reason: REASON,
          })
        ).status,
      ).toBe(403);
      const { rows } = await t
        .owner()
        .query(
          `SELECT 1 FROM identity.identity_audit_log WHERE action = 'ADMIN_ACTION_DENIED' AND actor_user_id = $1 AND outcome = 'DENIED'`,
          [ops.userId],
        );
      expect(rows).toHaveLength(3);
      const { rows: stored } = await t.owner().query(`SELECT 1 FROM identity.staff_invitations`);
      expect(stored).toHaveLength(0);
    });

    it('refuses a consumer session and an anonymous caller', async () => {
      const someone = await person();
      expect(
        (await as(someone.token).post('/admin/staff-invitations', { email: 'a@example.com' })).status,
      ).toBe(403);
      expect((await request(app).post('/v1/admin/staff-invitations').send({})).status).toBe(401);
    });

    it('answers 400 without a reason', async () => {
      const admin = await staff('SUPER_ADMIN');
      const response = await as(admin.token).post('/admin/staff-invitations', {
        email: 'a@example.com',
        roleCode: 'KYC_ANALYST',
      });
      expect(response.status).toBe(400);
      expect((await as(admin.token).get('/admin/staff-invitations')).status).toBe(400);
    });

    it('refuses self, duplicate and already-holds invitations', async () => {
      const admin = await staff('SUPER_ADMIN');
      expect((await invite(admin, admin.email)).status).toBe(403);

      expect((await invite(admin, 'dup@example.com')).status).toBe(201);
      expect((await invite(admin, 'dup@example.com')).status).toBe(409);

      const holder = await seedMember(t, app, { roles: ['KYC_ANALYST'] });
      expect((await invite(admin, holder.email)).status).toBe(409);
    });

    it('cancels once, then answers 404', async () => {
      const admin = await staff('SUPER_ADMIN');
      const { invitationId } = bodyOf<Created>(await invite(admin, 'gone@example.com'));
      const path = `/admin/staff-invitations/${invitationId}`;

      expect((await as(admin.token).del(path, { reason: REASON })).status).toBe(200);
      expect((await as(admin.token).del(path, { reason: REASON })).status).toBe(404);
      const listed = await as(admin.token).get(`/admin/staff-invitations?status=CANCELLED&reason=${REASON}`);
      expect(bodyOf<Page<View>>(listed).items.map((v) => v.id)).toEqual([invitationId]);
    });
  });

  describe('acceptance', () => {
    it('runs start, then accept, and the invitee holds the role', async () => {
      const admin = await staff('SUPER_ADMIN');
      const invitee = await person();
      const { token } = bodyOf<Created>(await invite(admin, invitee.email));

      const started = await as(invitee.token).post('/me/staff-invitations/start', { token });
      expect(started.status).toBe(200);
      const { challengeId } = bodyOf<Started>(started);
      const code = await codeFor(challengeId);

      const accepted = await as(invitee.token).post('/me/staff-invitations/accept', {
        token,
        challengeId,
        code,
      });
      expect(accepted.status).toBe(200);
      expect(bodyOf<Accepted>(accepted)).toMatchObject({ status: 'GRANTED', roleCode: 'KYC_ANALYST' });
      expect(await liveRoles(invitee.userId)).toEqual(['KYC_ANALYST']);

      // The token is spent.
      expect((await as(invitee.token).post('/me/staff-invitations/start', { token })).status).toBe(404);
    });

    it('needs a signed-in consumer: anonymous 401, staff session 403', async () => {
      const admin = await staff('SUPER_ADMIN');
      const body = { token: 't'.repeat(43) };
      expect((await request(app).post('/v1/me/staff-invitations/start').send(body)).status).toBe(401);
      expect((await as(admin.token).post('/me/staff-invitations/start', body)).status).toBe(403);
    });

    it('answers 404 for an account that does not own the address', async () => {
      const admin = await staff('SUPER_ADMIN');
      const owner = await person();
      const stranger = await person();
      const { token } = bodyOf<Created>(await invite(admin, owner.email));

      const response = await as(stranger.token).post('/me/staff-invitations/start', { token });
      expect(response.status).toBe(404);
      expect(bodyOf<Problem>(response).code).toBe('NOT_FOUND');
      expect(await liveRoles(stranger.userId)).toEqual([]);
    });

    it('charges a wrong code (422 with attempts left) and then accepts the right one', async () => {
      const admin = await staff('SUPER_ADMIN');
      const invitee = await person();
      const { token } = bodyOf<Created>(await invite(admin, invitee.email));
      const { challengeId } = bodyOf<Started>(
        await as(invitee.token).post('/me/staff-invitations/start', { token }),
      );
      const code = await codeFor(challengeId);

      const wrong = await as(invitee.token).post('/me/staff-invitations/accept', {
        token,
        challengeId,
        code: code === '000000' ? '111111' : '000000',
      });
      expect(wrong.status).toBe(422);
      expect(bodyOf<Problem & { attemptsRemaining?: number }>(wrong).code).toBe('OTP_INVALID');
      const { rows } = await t
        .owner()
        .query<{ attempts: number }>(`SELECT attempts FROM identity.otp_challenges WHERE id = $1`, [
          challengeId,
        ]);
      expect(rows[0]?.attempts).toBe(1);

      const right = await as(invitee.token).post('/me/staff-invitations/accept', {
        token,
        challengeId,
        code,
      });
      expect(right.status).toBe(200);
    });

    it('answers 409 when the invitee has no second factor', async () => {
      const admin = await staff('SUPER_ADMIN');
      const bare = await seedMember(t, app);
      const login = await request(app)
        .post('/v1/auth/login')
        .send({ identifier: bare.email, password: PASSWORD });
      const session = bodyOf<SessionBody>(login).accessToken;
      const { token } = bodyOf<Created>(await invite(admin, bare.email));
      const { challengeId } = bodyOf<Started>(
        await as(session).post('/me/staff-invitations/start', { token }),
      );

      const response = await as(session).post('/me/staff-invitations/accept', {
        token,
        challengeId,
        code: await codeFor(challengeId),
      });

      expect(response.status).toBe(409);
      expect(await liveRoles(bare.userId)).toEqual([]);
    });

    it('opens a ROLE_GRANT approval for FINANCE_ADMIN, and a second SUPER_ADMIN executes it', async () => {
      const admin = await staff('SUPER_ADMIN');
      const approver = await staff('SUPER_ADMIN');
      const invitee = await person();
      const { token } = bodyOf<Created>(await invite(admin, invitee.email, 'FINANCE_ADMIN'));
      const { challengeId } = bodyOf<Started>(
        await as(invitee.token).post('/me/staff-invitations/start', { token }),
      );

      const accepted = await as(invitee.token).post('/me/staff-invitations/accept', {
        token,
        challengeId,
        code: await codeFor(challengeId),
      });
      expect(accepted.status).toBe(200);
      const body = bodyOf<Accepted>(accepted);
      expect(body.status).toBe('PENDING_APPROVAL');
      expect(await liveRoles(invitee.userId)).toEqual([]);

      const decided = await as(approver.token).post(`/admin/approvals/${body.approvalId}/approve`, {
        reason: REASON,
      });
      expect(decided.status).toBe(200);
      expect(await liveRoles(invitee.userId)).toEqual(['FINANCE_ADMIN']);
    });

    it('stops at the two-holder SUPER_ADMIN cap when the approval executes', async () => {
      const admin = await staff('SUPER_ADMIN');
      const second = await staff('SUPER_ADMIN');
      const invitee = await person();
      const { token } = bodyOf<Created>(await invite(admin, invitee.email, 'SUPER_ADMIN'));
      const { challengeId } = bodyOf<Started>(
        await as(invitee.token).post('/me/staff-invitations/start', { token }),
      );
      const accepted = bodyOf<Accepted>(
        await as(invitee.token).post('/me/staff-invitations/accept', {
          token,
          challengeId,
          code: await codeFor(challengeId),
        }),
      );

      const decided = await as(second.token).post(`/admin/approvals/${accepted.approvalId}/approve`, {
        reason: REASON,
      });
      expect(decided.status).toBe(409);
      expect(await liveRoles(invitee.userId)).toEqual([]);
    });

    it('refuses once the inviter has lost SUPER_ADMIN', async () => {
      const admin = await staff('SUPER_ADMIN');
      const invitee = await person();
      const { token } = bodyOf<Created>(await invite(admin, invitee.email));
      await t
        .owner()
        .query(
          `UPDATE identity.admin_role_assignments SET revoked_at = now(), revoke_reason = 'left' WHERE user_id = $1`,
          [admin.userId],
        );
      const { challengeId } = bodyOf<Started>(
        await as(invitee.token).post('/me/staff-invitations/start', { token }),
      );

      const response = await as(invitee.token).post('/me/staff-invitations/accept', {
        token,
        challengeId,
        code: await codeFor(challengeId),
      });

      expect(response.status).toBe(409);
      expect(await liveRoles(invitee.userId)).toEqual([]);
    });

    it('answers 404 for a cancelled or lapsed invitation', async () => {
      const admin = await staff('SUPER_ADMIN');
      const invitee = await person();
      const cancelled = bodyOf<Created>(await invite(admin, invitee.email));
      await as(admin.token).del(`/admin/staff-invitations/${cancelled.invitationId}`, { reason: REASON });
      expect(
        (await as(invitee.token).post('/me/staff-invitations/start', { token: cancelled.token })).status,
      ).toBe(404);

      const lapsed = bodyOf<Created>(await invite(admin, invitee.email));
      await t
        .owner()
        .query(
          `UPDATE identity.staff_invitations SET expires_at = now() - interval '1 minute' WHERE id = $1`,
          [lapsed.invitationId],
        );
      expect(
        (await as(invitee.token).post('/me/staff-invitations/start', { token: lapsed.token })).status,
      ).toBe(404);
    });
  });
});
