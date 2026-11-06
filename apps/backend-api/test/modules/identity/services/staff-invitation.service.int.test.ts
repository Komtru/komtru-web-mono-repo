// T-038 against the real database: what an invitation stores, who may write one, and the acceptance
// rules that make a forwarded token useless. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../../../src/platform/errors.js';
import { createEncryption } from '../../../../src/platform/crypto/encryption.js';
import { createHmacHasher } from '../../../../src/platform/crypto/hmac.js';
import { normaliseEmail } from '../../../../src/platform/identifiers.js';
import { decideApproval } from '../../../../src/modules/identity/services/approval.service.js';
import { attachEmail, markEmailVerified } from '../../../../src/modules/identity/services/contact.service.js';
import type { StaffActor } from '../../../../src/modules/identity/services/rbac.service.js';
import {
  acceptStaffInvitation,
  bindStaffInvitationsForDestination,
  cancelStaffInvitation,
  createStaffInvitation,
  expireStaffInvitations,
  startStaffInvitationAcceptance,
  type AcceptStaffInvitationResult,
  type StaffInvitationDeps,
} from '../../../../src/modules/identity/services/staff-invitation.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { assignRole, buildApp, seedCatalogue, seedMember, type Member } from '../http/staff.support.js';
import { createTestRedis, redisReady, seedUser, testConfig, testLogger } from '../support.js';

const REASON = 'onboarding the new analyst';

describe.runIf(infraEnabled)('staff invitations (T-038)', () => {
  const t = useTestDatabase();
  const hasher = createHmacHasher('a-pepper-for-tests-0123456789abc');
  const encryption = createEncryption(testConfig({ ENCRYPTION_KEY: randomBytes(32).toString('hex') }));
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

  const deps = (): StaffInvitationDeps => ({ db: t.db(), hasher, encryption, logger: testLogger });
  const actorOf = (member: Member): StaffActor => ({ userId: member.userId, roles: ['SUPER_ADMIN'] });
  const superAdmin = async (): Promise<Member> => seedMember(t, app, { roles: ['SUPER_ADMIN'] });
  /** A registered account with a verified primary email and (optionally) a TOTP factor. */
  const invitee = (mfa = true): Promise<Member> => seedMember(t, app, { mfa });

  const invite = (inviter: Member, email: string, roleCode = 'KYC_ANALYST', extra = {}) =>
    createStaffInvitation(deps(), { actor: actorOf(inviter), email, roleCode, reason: REASON, ...extra });

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

  const start = (member: Member, token: string) =>
    startStaffInvitationAcceptance(deps(), { userId: member.userId, token, ip: null });

  const accept = (
    member: Member,
    token: string,
    challengeId: string,
    code: string,
  ): Promise<AcceptStaffInvitationResult> =>
    acceptStaffInvitation(deps(), {
      userId: member.userId,
      token,
      challengeId,
      code,
      ip: null,
      userAgent: null,
    });

  /** The whole happy path for an account whose email is the invited address. */
  const acceptFully = async (member: Member, token: string) => {
    const issued = await start(member, token);
    return accept(member, token, issued.challengeId, await codeFor(issued.challengeId));
  };

  const failure = async (promise: Promise<unknown>): Promise<ApiError> => {
    try {
      await promise;
    } catch (error) {
      if (error instanceof ApiError) return error;
      throw error;
    }
    throw new Error('expected an ApiError');
  };

  const row = async (id: string) =>
    (
      await t
        .owner()
        .query<Record<string, unknown>>(`SELECT * FROM identity.staff_invitations WHERE id = $1`, [id])
    ).rows[0];

  const liveRoles = async (userId: string): Promise<string[]> =>
    (
      await t
        .owner()
        .query<{ role_code: string }>(
          `SELECT role_code FROM identity.admin_role_assignments WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId],
        )
    ).rows.map((r) => r.role_code);

  const audits = async (action: string) =>
    (
      await t
        .owner()
        .query<{ outcome: string; metadata: Record<string, unknown> | null }>(
          `SELECT outcome, metadata FROM identity.identity_audit_log WHERE action = $1 ORDER BY occurred_at`,
          [action],
        )
    ).rows;

  describe('creating', () => {
    it('stores a hashed lookup, a masked display and a sealed address, never plaintext', async () => {
      const admin = await superAdmin();
      const created = await invite(admin, 'Ada.Okafor+Ops@Example.com');
      const stored = await row(created.invitationId);

      expect(stored?.destination_masked).toBe(created.maskedDestination);
      expect(encryption.open(stored?.destination_enc as Buffer)).toBe('Ada.Okafor+Ops@Example.com');
      const dump = JSON.stringify(stored).toLowerCase();
      expect(dump).not.toContain('okafor');
      expect(dump).not.toContain(created.token.toLowerCase());
      // Only the SHA-256 of the token is kept.
      expect((stored?.token_hash as Buffer).length).toBe(32);

      // Nor does the outbox or the audit log hold the address.
      const outbox = await t.app().query(`SELECT payload FROM platform.outbox`);
      expect(JSON.stringify(outbox.rows).toLowerCase()).not.toContain('okafor');
      expect(JSON.stringify(await audits('STAFF_INVITATION_CREATED')).toLowerCase()).not.toContain('okafor');
    });

    it('creates no users row', async () => {
      const admin = await superAdmin();
      const before = await t.owner().query(`SELECT count(*)::int AS n FROM identity.users`);
      await invite(admin, 'nobody-yet@example.com');
      const after = await t.owner().query(`SELECT count(*)::int AS n FROM identity.users`);
      expect(after.rows[0]).toEqual(before.rows[0]);
    });

    it('is SUPER_ADMIN only, and a refusal leaves a DENIED audit row and no invitation', async () => {
      const analyst = await seedMember(t, app, { roles: ['OPERATIONS_ADMIN'] });
      const error = await failure(
        createStaffInvitation(deps(), {
          actor: { userId: analyst.userId, roles: ['OPERATIONS_ADMIN'] },
          email: 'x@example.com',
          roleCode: 'KYC_ANALYST',
          reason: REASON,
        }),
      );
      expect(error.status).toBe(403);
      const denied = (await audits('ADMIN_ACTION_DENIED')).filter((a) => a.outcome === 'DENIED');
      expect(denied).toHaveLength(1);
      expect(denied[0]?.metadata).toMatchObject({ permission: 'role.grant' });
      const { rows } = await t.owner().query(`SELECT 1 FROM identity.staff_invitations`);
      expect(rows).toHaveLength(0);
    });

    it('refuses an invitation to the inviter themselves, with a DENIED row', async () => {
      const admin = await superAdmin();
      const error = await failure(invite(admin, admin.email));
      expect(error.status).toBe(403);
      const denied = await audits('ADMIN_ACTION_DENIED');
      expect(denied.at(-1)?.metadata).toMatchObject({ denied: 'SELF_GRANT' });
    });

    it('refuses a second pending invitation for the same address and role, but not another role', async () => {
      const admin = await superAdmin();
      await invite(admin, 'dup@example.com');
      const error = await failure(invite(admin, 'DUP@example.com'));
      expect(error.status).toBe(409);
      await expect(invite(admin, 'dup@example.com', 'OPERATIONS_ADMIN')).resolves.toBeDefined();
    });

    it('refuses an address whose owner already holds the role', async () => {
      const admin = await superAdmin();
      const holder = await seedMember(t, app, { roles: ['KYC_ANALYST'] });
      const error = await failure(invite(admin, holder.email));
      expect(error.status).toBe(409);
    });

    it('refuses an unknown role (404) and an out-of-range grant expiry (400)', async () => {
      const admin = await superAdmin();
      expect((await failure(invite(admin, 'a@example.com', 'NOT_A_ROLE'))).status).toBe(404);
      const tooFar = new Date(Date.now() + 400 * 24 * 3600 * 1000);
      expect(
        (await failure(invite(admin, 'a@example.com', 'KYC_ANALYST', { grantExpiresAt: tooFar }))).status,
      ).toBe(400);
    });
  });

  describe('accepting', () => {
    it('grants an existing user the role after an OTP on their own address', async () => {
      const admin = await superAdmin();
      const person = await invitee();
      const { token, invitationId } = await invite(admin, person.email);

      const result = await acceptFully(person, token);

      expect(result).toMatchObject({ outcome: 'GRANTED', roleCode: 'KYC_ANALYST' });
      expect(await liveRoles(person.userId)).toEqual(['KYC_ANALYST']);
      const stored = await row(invitationId);
      expect(stored).toMatchObject({ status: 'CLAIMED', claimed_by_user_id: person.userId });
      expect(await audits('STAFF_INVITATION_ACCEPTED')).toHaveLength(1);
      const { rows } = await t
        .owner()
        .query<{ granted_by: string }>(
          `SELECT granted_by FROM identity.admin_role_assignments WHERE user_id = $1`,
          [person.userId],
        );
      expect(rows[0]?.granted_by).toBe(admin.userId);
    });

    it('cannot be accepted twice', async () => {
      const admin = await superAdmin();
      const person = await invitee();
      const { token } = await invite(admin, person.email);
      await acceptFully(person, token);
      expect((await failure(start(person, token))).status).toBe(404);
    });

    it('binds an invitation to a new account on verification, and grants nothing until MFA exists', async () => {
      const admin = await superAdmin();
      const email = 'newcomer@example.com';
      const { token, invitationId } = await invite(admin, email);
      expect((await row(invitationId))?.bound_user_id).toBeNull();

      // The normal registration flow: an account, then a verified email.
      const { userId } = await seedUser(t.app());
      const newcomer: Member = { userId, email, nextOffset: 0 };
      await t.db().transaction(async (tx) => {
        const attached = await attachEmail(tx, { userId, email, makePrimary: true });
        await markEmailVerified(tx, { userId, emailId: attached.emailId, source: 'otp' });
        await bindStaffInvitationsForDestination(
          tx,
          { hasher },
          { userId, canonical: normaliseEmail(email).emailNormal },
        );
      });

      expect(await row(invitationId)).toMatchObject({ status: 'PENDING', bound_user_id: userId });
      expect(await liveRoles(userId)).toEqual([]);
      expect(await audits('STAFF_INVITATION_BOUND')).toHaveLength(1);

      // A fresh account has no second factor, so the grant is refused (and the invitation survives).
      const result = await acceptFully(newcomer, token);
      expect(result.outcome).toBe('REFUSED');
      expect(result.outcome === 'REFUSED' && result.error.status).toBe(409);
      expect(await liveRoles(userId)).toEqual([]);
      expect((await row(invitationId))?.status).toBe('PENDING');
    });

    it('answers 404 when the session user is not the address owner, and for a bad token', async () => {
      const admin = await superAdmin();
      const owner = await invitee();
      const stranger = await invitee();
      const { token } = await invite(admin, owner.email);

      expect((await failure(start(stranger, token))).status).toBe(404);
      expect((await failure(start(owner, 'x'.repeat(43)))).status).toBe(404);
      // Same for an account with no verified email at all.
      const { userId } = await seedUser(t.app());
      expect((await failure(start({ userId, email: '', nextOffset: 0 }, token))).status).toBe(404);
      expect(await liveRoles(stranger.userId)).toEqual([]);
    });

    it('charges a wrong code against the challenge, and still grants on the right one', async () => {
      const admin = await superAdmin();
      const person = await invitee();
      const { token } = await invite(admin, person.email);
      const issued = await start(person, token);
      const code = await codeFor(issued.challengeId);

      const wrong = await accept(person, token, issued.challengeId, code === '000000' ? '111111' : '000000');
      expect(wrong).toMatchObject({ outcome: 'WRONG_CODE', attemptsRemaining: 4 });
      const { rows } = await t
        .owner()
        .query<{ attempts: number }>(`SELECT attempts FROM identity.otp_challenges WHERE id = $1`, [
          issued.challengeId,
        ]);
      expect(rows[0]?.attempts).toBe(1);
      expect(await liveRoles(person.userId)).toEqual([]);

      expect(await accept(person, token, issued.challengeId, code)).toMatchObject({ outcome: 'GRANTED' });
    });

    it('ignores a challenge that was issued to someone else', async () => {
      const admin = await superAdmin();
      const person = await invitee();
      const other = await invitee();
      const { token } = await invite(admin, person.email);
      await start(person, token);
      // A challenge for the other user's own address, with a perfectly good code.
      const { issueOtp } = await import('../../../../src/modules/identity/services/otp.service.js');
      const foreign = await t.db().transaction((tx) =>
        issueOtp(
          tx,
          { hasher, logger: testLogger },
          {
            userId: other.userId,
            purpose: 'SENSITIVE_ACTION',
            channels: ['EMAIL'],
            destination: normaliseEmail(other.email).emailNormal,
            ip: null,
          },
        ),
      );
      const result = await accept(person, token, foreign.challengeId, await codeFor(foreign.challengeId));
      expect(result.outcome).toBe('UNKNOWN');
      expect(await liveRoles(person.userId)).toEqual([]);
    });

    it('refuses with 409 when the invitee has no second factor, spending the code but not the invitation', async () => {
      const admin = await superAdmin();
      const person = await invitee(false);
      const { token, invitationId } = await invite(admin, person.email);
      const issued = await start(person, token);
      const code = await codeFor(issued.challengeId);

      const result = await accept(person, token, issued.challengeId, code);

      expect(result.outcome).toBe('REFUSED');
      expect(result.outcome === 'REFUSED' && result.error.status).toBe(409);
      expect(await liveRoles(person.userId)).toEqual([]);
      expect((await row(invitationId))?.status).toBe('PENDING');
      // The code was consumed: the refusal cannot be used to keep guessing or to retry for free.
      const { rows } = await t
        .owner()
        .query<{ consumed_at: Date | null }>(
          `SELECT consumed_at FROM identity.otp_challenges WHERE id = $1`,
          [issued.challengeId],
        );
      expect(rows[0]?.consumed_at).not.toBeNull();
    });

    it('refuses when the inviter has since lost SUPER_ADMIN', async () => {
      const admin = await superAdmin();
      const person = await invitee();
      const { token, invitationId } = await invite(admin, person.email);
      await t
        .owner()
        .query(
          `UPDATE identity.admin_role_assignments SET revoked_at = now(), revoke_reason = 'left' WHERE user_id = $1`,
          [admin.userId],
        );

      const result = await acceptFully(person, token);

      expect(result.outcome).toBe('REFUSED');
      expect(result.outcome === 'REFUSED' && result.error.status).toBe(409);
      expect(await liveRoles(person.userId)).toEqual([]);
      expect((await row(invitationId))?.status).toBe('PENDING');
    });

    it('opens a ROLE_GRANT approval for a FINANCE_ADMIN invitation instead of granting', async () => {
      const admin = await superAdmin();
      const person = await invitee();
      const { token, invitationId } = await invite(admin, person.email, 'FINANCE_ADMIN');

      const result = await acceptFully(person, token);

      expect(result.outcome).toBe('PENDING_APPROVAL');
      expect(await liveRoles(person.userId)).toEqual([]);
      const { rows } = await t.owner().query<{
        action: string;
        requested_by: string;
        subject_user_id: string;
        executed_at: Date | null;
        payload: { roleCode: string };
      }>(`SELECT * FROM identity.admin_action_approvals`);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'ROLE_GRANT',
        requested_by: admin.userId,
        subject_user_id: person.userId,
        executed_at: null,
      });
      expect(rows[0]?.payload.roleCode).toBe('FINANCE_ADMIN');
      expect((await row(invitationId))?.status).toBe('CLAIMED');
    });

    it('applies the two-holder SUPER_ADMIN cap when the approval executes', async () => {
      const admin = await superAdmin();
      const second = await superAdmin();
      const person = await invitee();
      const { token } = await invite(admin, person.email, 'SUPER_ADMIN');

      const result = await acceptFully(person, token);
      expect(result.outcome).toBe('PENDING_APPROVAL');
      if (result.outcome !== 'PENDING_APPROVAL') return;

      const error = await failure(
        decideApproval(
          { db: t.db() },
          {
            actor: actorOf(second),
            approvalId: result.approvalId,
            decision: 'APPROVE',
            reason: 'approving the new super admin',
          },
        ),
      );
      expect(error.status).toBe(409);
      expect(await liveRoles(person.userId)).toEqual([]);
    });

    it('keeps the second factor, one-live-grant and 365-day rules of a hand-made grant', async () => {
      const admin = await superAdmin();
      const person = await invitee();
      const { token } = await invite(admin, person.email, 'KYC_ANALYST');
      // The person is granted the same role by another route between invite and accept.
      await assignRole(t, person.userId, 'KYC_ANALYST');

      const result = await acceptFully(person, token);

      expect(result.outcome).toBe('REFUSED');
      expect(await liveRoles(person.userId)).toEqual(['KYC_ANALYST']);
    });
  });

  describe('listing, expiry and cancel', () => {
    it('cancels a pending invitation once, after which its token is dead', async () => {
      const admin = await superAdmin();
      const person = await invitee();
      const { token, invitationId } = await invite(admin, person.email);

      await cancelStaffInvitation(t.db(), { actor: actorOf(admin), invitationId, reason: REASON });

      expect(await row(invitationId)).toMatchObject({ status: 'CANCELLED', cancelled_by: admin.userId });
      expect((await failure(start(person, token))).status).toBe(404);
      expect(
        (
          await failure(
            cancelStaffInvitation(t.db(), { actor: actorOf(admin), invitationId, reason: REASON }),
          )
        ).status,
      ).toBe(404);
      expect(await audits('STAFF_INVITATION_CANCELLED')).toHaveLength(1);
    });

    it('treats a lapsed invitation as dead before the sweep, and the sweep marks it EXPIRED', async () => {
      const admin = await superAdmin();
      const person = await invitee();
      const lapsed = await invite(admin, person.email);
      const fresh = await invite(admin, 'fresh@example.com');
      await t
        .owner()
        .query(
          `UPDATE identity.staff_invitations SET expires_at = now() - interval '1 minute' WHERE id = $1`,
          [lapsed.invitationId],
        );

      expect((await failure(start(person, lapsed.token))).status).toBe(404);
      // The expired address can be invited again.
      await expect(invite(admin, person.email)).resolves.toBeDefined();

      expect(await expireStaffInvitations(t.db())).toEqual({ expired: 1 });
      expect((await row(lapsed.invitationId))?.status).toBe('EXPIRED');
      expect((await row(fresh.invitationId))?.status).toBe('PENDING');
      expect(await expireStaffInvitations(t.db())).toEqual({ expired: 0 });
    });

    it('does not bind a lapsed or already-bound invitation', async () => {
      const admin = await superAdmin();
      const lapsed = await invite(admin, 'late@example.com');
      await t
        .owner()
        .query(
          `UPDATE identity.staff_invitations SET expires_at = now() - interval '1 minute' WHERE id = $1`,
          [lapsed.invitationId],
        );
      const { userId } = await seedUser(t.app());
      const bound = await t
        .db()
        .transaction((tx) =>
          bindStaffInvitationsForDestination(tx, { hasher }, { userId, canonical: 'late@example.com' }),
        );
      expect(bound).toBe(0);
    });
  });
});
