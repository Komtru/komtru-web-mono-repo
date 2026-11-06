// Staff invitations (T-038): the rows, the acceptance and the sweep.
//
// Three rules shape this file.
//
//   1. NOTHING HERE WRITES A ROLE OUTSIDE `insertAssignment` (or, for a dual-approval role, outside
//      a `ROLE_GRANT` approval that `insertAssignment` later executes). So the second factor, the
//      365-day box, the two-holder SUPER_ADMIN cap and one-live-grant-per-role all apply to an
//      invitee exactly as they apply to a grant made by hand.
//   2. AN INVITATION NEVER CREATES A `users` ROW. The address is proven by the invitee's OWN
//      account, which registered the normal way, and acceptance additionally needs a fresh OTP on
//      that address. Binding on verification only records who the address belongs to.
//   3. THE TOKEN IS NOT THE CREDENTIAL. It can be forwarded; what cannot be is the verified inbox. So
//      every step matches the session user's verified primary email against the invitation's
//      destination hash, and an invitation that does not match answers exactly like one that does
//      not exist.
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import type { Encryption } from '../../../platform/crypto/encryption.js';
import type { HmacHasher } from '../../../platform/crypto/hmac.js';
import { ApiError } from '../../../platform/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { maskEmail, normaliseEmail } from '../../../platform/identifiers.js';
import type { Logger } from '../../../platform/logger.js';
import {
  identityStaffInvitationAcceptedEvent,
  identityStaffInvitationCancelledEvent,
  identityStaffInvitationCreatedEvent,
} from '../domain/events.js';
import { isSecondFactor } from '../domain/mfa/policy.js';
import { hashDestination } from '../domain/otp/challenge.js';
import { validateRoleGrant } from '../domain/rbac/sod.js';
import {
  STAFF_INVITATION_DESTINATION_DOMAIN,
  canAcceptStaffInvitation,
  issueStaffInvitationToken,
  staffInvitationDestinationHash,
  staffInvitationExpiry,
  staffInvitationTokenHash,
  validateStaffInvitation,
  type StaffInvitationStatus,
} from '../domain/staff-invitation.js';
import { staffInvitations } from '../infrastructure/postgres/schema/staff-invitations.js';
import { users } from '../infrastructure/postgres/schema/users.js';
import { openApproval } from './approval.service.js';
import { AUDIT_ACTIONS, writeAudit } from './audit.service.js';
import { findUserByVerifiedEmail, primaryContacts } from './contact.service.js';
import { activeFactors } from './mfa.service.js';
import {
  consumeOtp,
  findLiveChallenge,
  issueOtp,
  type IssuedOtp,
  type VerifyOutcome,
} from './otp.service.js';
import {
  auditStaff,
  insertAssignment,
  isDualApprovalRole,
  liveRoleCodes,
  refuse,
  requireAuthorised,
  type StaffActor,
} from './rbac.service.js';

export interface StaffInvitationDeps {
  db: Db;
  /** The pepper every identity HMAC uses, under this module's own domains. */
  hasher: HmacHasher;
  encryption: Encryption;
  logger: Logger;
}

const notFound = () => new ApiError(404, 'NOT_FOUND', 'No such invitation');
const conflict = (detail: string) => new ApiError(409, 'CONFLICT', 'Conflict', detail);

export interface CreateStaffInvitationInput {
  actor: StaffActor;
  email: string;
  roleCode: string;
  reason: string;
  grantExpiresAt?: Date | undefined;
}

export interface CreatedStaffInvitation {
  invitationId: string;
  /** Returned once, to the inviter. Only its hash is stored. */
  token: string;
  maskedDestination: string;
  expiresAt: Date;
}

/**
 * `POST /admin/staff-invitations`. `role.grant` is SUPER_ADMIN's alone, which is also the rule that
 * only a SUPER_ADMIN may bring in another staff member, for every role including the dual-approval
 * ones (their second approver is found at acceptance).
 */
export async function createStaffInvitation(
  deps: StaffInvitationDeps,
  input: CreateStaffInvitationInput,
): Promise<CreatedStaffInvitation> {
  const { actor } = input;
  await requireAuthorised(deps.db, actor, { permission: 'role.grant' }, input.reason);

  const now = new Date();
  const verdict = validateStaffInvitation({
    roleCode: input.roleCode,
    grantExpiresAt: input.grantExpiresAt,
    now,
  });
  if (!verdict.ok) {
    throw verdict.reason === 'UNKNOWN_ROLE'
      ? new ApiError(404, 'NOT_FOUND', 'No such role')
      : new ApiError(
          400,
          'VALIDATION_FAILED',
          'Invalid expiry',
          'expiresAt must be in the future and within a year',
        );
  }

  const canonical = normaliseEmail(input.email).emailNormal;
  const destinationHash = staffInvitationDestinationHash(deps.hasher, canonical);
  const { token, tokenHash } = issueStaffInvitationToken();
  const masked = maskEmail(input.email);
  const expiresAt = staffInvitationExpiry(now);

  return deps.db.transaction(async (tx) => {
    const owner = await findUserByVerifiedEmail(tx, canonical);
    if (owner?.userId === actor.userId) {
      return refuse(deps.db, actor, {
        permission: 'role.grant',
        reason: input.reason,
        denied: 'SELF_GRANT',
      });
    }
    if (owner && (await liveRoleCodes(tx, owner.userId)).includes(input.roleCode)) {
      throw conflict('That person already holds that role');
    }

    // One pending invitation per address and role. A second one would only be a second live token.
    const duplicate = await tx
      .select({ id: staffInvitations.id })
      .from(staffInvitations)
      .where(
        and(
          eq(staffInvitations.destinationHash, destinationHash),
          eq(staffInvitations.roleCode, input.roleCode),
          eq(staffInvitations.status, 'PENDING'),
          sql`${staffInvitations.expiresAt} > now()`,
        ),
      )
      .limit(1);
    if (duplicate.length > 0) throw conflict('That address already has a pending invitation for that role');

    const row = (
      await tx
        .insert(staffInvitations)
        .values({
          invitedBy: actor.userId,
          roleCode: input.roleCode,
          destinationHash,
          destinationMasked: masked,
          // The deliverable address as typed, as `party_invitations` does: canonicalisation is for
          // matching, and rewriting a person's address is its own bug.
          destinationEnc: deps.encryption.seal(input.email.trim()),
          reason: input.reason,
          grantExpiresAt: verdict.grantExpiresAt,
          tokenHash,
          expiresAt,
        })
        .returning({ id: staffInvitations.id })
    )[0];
    if (!row) throw new Error('createStaffInvitation: the insert returned no row');

    await auditStaff(tx, actor, {
      action: AUDIT_ACTIONS.STAFF_INVITATION_CREATED,
      reason: input.reason,
      metadata: { invitationId: row.id, roleCode: input.roleCode, maskedDestination: masked },
    });
    await publish(tx, identityStaffInvitationCreatedEvent, {
      payload: {
        invitationId: row.id,
        invitedBy: actor.userId,
        roleCode: input.roleCode,
        maskedDestination: masked,
        expiresAt: expiresAt.toISOString(),
      },
      aggregateType: 'identity.staff_invitation',
      aggregateId: row.id,
      actor: { type: 'STAFF', id: actor.userId },
    });
    return { invitationId: row.id, token, maskedDestination: masked, expiresAt };
  });
}

export interface StaffInvitationView {
  id: string;
  roleCode: string;
  maskedDestination: string;
  status: StaffInvitationStatus;
  invitedBy: string;
  boundUserId: string | null;
  claimedByUserId: string | null;
  grantExpiresAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

/** `GET /admin/staff-invitations`. Never returns the token, the hash or the sealed address. */
export async function listStaffInvitations(
  db: Db,
  input: {
    actor: StaffActor;
    reason: string;
    status?: StaffInvitationStatus | undefined;
    page: number;
    limit: number;
  },
): Promise<{ items: StaffInvitationView[]; page: number; limit: number; total: number }> {
  await requireAuthorised(db, input.actor, { permission: 'role.grant' }, input.reason);
  const where = input.status ? eq(staffInvitations.status, input.status) : undefined;
  return db.transaction(async (tx) => {
    const [rows, count] = await Promise.all([
      tx
        .select({
          id: staffInvitations.id,
          roleCode: staffInvitations.roleCode,
          maskedDestination: staffInvitations.destinationMasked,
          status: staffInvitations.status,
          invitedBy: staffInvitations.invitedBy,
          boundUserId: staffInvitations.boundUserId,
          claimedByUserId: staffInvitations.claimedByUserId,
          grantExpiresAt: staffInvitations.grantExpiresAt,
          expiresAt: staffInvitations.expiresAt,
          createdAt: staffInvitations.createdAt,
        })
        .from(staffInvitations)
        .where(where)
        .orderBy(desc(staffInvitations.createdAt), desc(staffInvitations.id))
        .limit(input.limit)
        .offset((input.page - 1) * input.limit),
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(staffInvitations)
        .where(where),
    ]);
    await auditStaff(tx, input.actor, {
      action: AUDIT_ACTIONS.ADMIN_STAFF_INVITATIONS_LISTED,
      reason: input.reason,
      metadata: { status: input.status ?? null, page: input.page },
    });
    return { items: rows, page: input.page, limit: input.limit, total: count[0]?.n ?? 0 };
  });
}

/** `DELETE /admin/staff-invitations/:id`. Only a PENDING invitation can be cancelled. */
export async function cancelStaffInvitation(
  db: Db,
  input: { actor: StaffActor; invitationId: string; reason: string },
): Promise<{ cancelledAt: Date }> {
  const { actor } = input;
  await requireAuthorised(db, actor, { permission: 'role.grant' }, input.reason);
  return db.transaction(async (tx) => {
    const row = (
      await tx
        .update(staffInvitations)
        .set({ status: 'CANCELLED', cancelledBy: actor.userId, cancelledAt: sql`now()` })
        .where(and(eq(staffInvitations.id, input.invitationId), eq(staffInvitations.status, 'PENDING')))
        .returning({ roleCode: staffInvitations.roleCode, cancelledAt: staffInvitations.cancelledAt })
    )[0];
    if (!row?.cancelledAt) throw notFound();
    await auditStaff(tx, actor, {
      action: AUDIT_ACTIONS.STAFF_INVITATION_CANCELLED,
      reason: input.reason,
      metadata: { invitationId: input.invitationId, roleCode: row.roleCode },
    });
    await publish(tx, identityStaffInvitationCancelledEvent, {
      payload: { invitationId: input.invitationId, cancelledBy: actor.userId, roleCode: row.roleCode },
      aggregateType: 'identity.staff_invitation',
      aggregateId: input.invitationId,
      actor: { type: 'STAFF', id: actor.userId },
    });
    return { cancelledAt: row.cancelledAt };
  });
}

type InvitationRow = typeof staffInvitations.$inferSelect;

/**
 * The invitation for this token, but only if it is live AND addressed to the session user's verified
 * primary email. Anything else is the same 404, so the token cannot be used to probe who an address
 * belongs to. Returns the canonical address, which the OTP is then bound to.
 */
async function invitationForUser(
  tx: Tx,
  deps: Pick<StaffInvitationDeps, 'hasher'>,
  input: { userId: string; token: string; lock?: boolean },
): Promise<{ invitation: InvitationRow; canonical: string }> {
  const query = tx
    .select()
    .from(staffInvitations)
    .where(eq(staffInvitations.tokenHash, staffInvitationTokenHash(input.token)))
    .limit(1);
  const invitation = (await (input.lock === true ? query.for('update') : query))[0];
  if (!invitation || !canAcceptStaffInvitation(invitation, new Date())) throw notFound();

  const email = (await primaryContacts(tx, input.userId)).email;
  if (!email?.verified) throw notFound();
  const canonical = normaliseEmail(email.address).emailNormal;
  const addressed = deps.hasher.matches(
    STAFF_INVITATION_DESTINATION_DOMAIN,
    canonical,
    Buffer.from(invitation.destinationHash),
  );
  if (!addressed) throw notFound();
  return { invitation, canonical };
}

/**
 * Step one of acceptance: send the OTP to the invited address.
 *
 * The OTP facility delivers to a user's own contact, so the invitee must already be a registered
 * account whose verified primary email IS the invited address. A person with no account registers
 * the normal way first; verifying that address binds the invitation to them
 * (`bindStaffInvitationsForDestination`).
 */
export async function startStaffInvitationAcceptance(
  deps: StaffInvitationDeps,
  input: { userId: string; token: string; ip: string | null },
): Promise<IssuedOtp> {
  return deps.db.transaction(async (tx) => {
    const { canonical } = await invitationForUser(tx, deps, input);
    return issueOtp(
      tx,
      { hasher: deps.hasher, logger: deps.logger },
      {
        userId: input.userId,
        purpose: 'SENSITIVE_ACTION',
        channels: ['EMAIL'],
        destination: canonical,
        ip: input.ip,
      },
    );
  });
}

export type AcceptStaffInvitationResult =
  | { outcome: 'GRANTED'; assignmentId: string; roleCode: string }
  | { outcome: 'PENDING_APPROVAL'; approvalId: string; roleCode: string }
  /** A grant rule said no (no second factor, cap reached...). The code is spent; the invitation is not. */
  | { outcome: 'REFUSED'; error: ApiError }
  | Exclude<VerifyOutcome, { outcome: 'VERIFIED' }>;

export interface AcceptStaffInvitationInput {
  userId: string;
  token: string;
  challengeId: string;
  code: string;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Step two: prove the address with the code, then grant.
 *
 * The transaction COMMITS on a wrong code and on a refused grant, as `verifyChallenge` does: the
 * attempt is charged before the comparison, and rolling it back would hand out free guesses. The
 * grant runs in a savepoint so its refusal undoes only the grant.
 */
export async function acceptStaffInvitation(
  deps: StaffInvitationDeps,
  input: AcceptStaffInvitationInput,
): Promise<AcceptStaffInvitationResult> {
  return deps.db.transaction(async (tx): Promise<AcceptStaffInvitationResult> => {
    const { invitation, canonical } = await invitationForUser(tx, deps, { ...input, lock: true });

    // The challenge must be this user's, for this purpose, on THIS address, checked before a
    // single attempt is spent: a code that was sent for something else proves nothing here.
    const challenge = await findLiveChallenge(tx, input.challengeId);
    if (
      !challenge ||
      challenge.userId !== input.userId ||
      challenge.purpose !== 'SENSITIVE_ACTION' ||
      !Buffer.from(challenge.destinationHash).equals(hashDestination(deps.hasher, canonical))
    ) {
      return { outcome: 'UNKNOWN' };
    }

    const verified = await consumeOtp(
      tx,
      { hasher: deps.hasher, logger: deps.logger },
      { challengeId: input.challengeId, code: input.code },
    );
    if (verified.outcome !== 'VERIFIED') return verified;

    try {
      return await tx.transaction((sp) => grantFromInvitation(sp, input, invitation));
    } catch (error) {
      if (error instanceof ApiError) return { outcome: 'REFUSED', error };
      throw error;
    }
  });
}

async function grantFromInvitation(
  tx: Tx,
  input: { userId: string; ip: string | null; userAgent: string | null },
  invitation: InvitationRow,
): Promise<AcceptStaffInvitationResult> {
  // The inviter's authority is re-read now. An invitation outlives the day it was written, and a
  // SUPER_ADMIN who has since been revoked must not be able to bring somebody in from the grave.
  if (!(await liveRoleCodes(tx, invitation.invitedBy)).includes('SUPER_ADMIN')) {
    throw conflict('The person who sent this invitation can no longer grant roles');
  }
  const user = (
    await tx.select({ status: users.status }).from(users).where(eq(users.id, input.userId)).for('update')
  )[0];
  if (user?.status !== 'ACTIVE') throw conflict('This account cannot take a staff role right now');

  const inviter: StaffActor = {
    userId: invitation.invitedBy,
    roles: ['SUPER_ADMIN'],
    ip: input.ip,
    userAgent: input.userAgent,
  };
  const grantExpiresAt = invitation.grantExpiresAt ?? undefined;
  let result: AcceptStaffInvitationResult;

  if (isDualApprovalRole(invitation.roleCode)) {
    const verdict = validateRoleGrant({
      roleCode: invitation.roleCode,
      userId: input.userId,
      grantedBy: invitation.invitedBy,
      ...(grantExpiresAt ? { expiresAt: grantExpiresAt } : {}),
      now: new Date(),
    });
    if (!verdict.ok) {
      throw verdict.reason === 'INVALID_EXPIRY'
        ? new ApiError(
            400,
            'VALIDATION_FAILED',
            'Invalid expiry',
            'The grant expiry in this invitation has passed',
          )
        : new ApiError(403, 'FORBIDDEN', 'You do not have permission to do that');
    }
    // Fail now, not a day later inside the approval: a role cannot be granted to a person with no
    // second factor, and an approver should not be asked to sign a grant that is bound to fail.
    const factors = await activeFactors(tx, input.userId);
    if (!factors.some((factor) => isSecondFactor(factor.factorType))) {
      throw conflict('Enrol a second factor before a staff role can be granted');
    }
    const opened = await openApproval(tx, {
      actor: inviter,
      action: 'ROLE_GRANT',
      subjectUserId: input.userId,
      reason: invitation.reason,
      payload: { roleCode: invitation.roleCode, expiresAt: verdict.expiresAt.toISOString() },
    });
    result = { outcome: 'PENDING_APPROVAL', approvalId: opened.approvalId, roleCode: invitation.roleCode };
  } else {
    const assignmentId = await insertAssignment(tx, {
      userId: input.userId,
      roleCode: invitation.roleCode,
      grantedBy: invitation.invitedBy,
      reason: invitation.reason,
      expiresAt: grantExpiresAt,
    });
    await auditStaff(tx, inviter, {
      action: AUDIT_ACTIONS.ROLE_GRANTED,
      subjectUserId: input.userId,
      reason: invitation.reason,
      metadata: { roleCode: invitation.roleCode, assignmentId, invitationId: invitation.id },
    });
    result = { outcome: 'GRANTED', assignmentId, roleCode: invitation.roleCode };
  }

  const approvalId = result.outcome === 'PENDING_APPROVAL' ? result.approvalId : null;
  await tx
    .update(staffInvitations)
    .set({ status: 'CLAIMED', claimedByUserId: input.userId, claimedAt: sql`now()` })
    .where(eq(staffInvitations.id, invitation.id));
  await writeAudit(tx, {
    action: AUDIT_ACTIONS.STAFF_INVITATION_ACCEPTED,
    outcome: 'SUCCESS',
    actorType: 'USER',
    actorUserId: input.userId,
    subjectUserId: input.userId,
    ip: input.ip,
    userAgent: input.userAgent,
    metadata: { invitationId: invitation.id, roleCode: invitation.roleCode, approvalId },
  });
  await publish(tx, identityStaffInvitationAcceptedEvent, {
    payload: {
      invitationId: invitation.id,
      invitedBy: invitation.invitedBy,
      acceptedByUserId: input.userId,
      roleCode: invitation.roleCode,
      approvalId,
    },
    aggregateType: 'identity.staff_invitation',
    aggregateId: invitation.id,
    actor: { type: 'CONSUMER', id: input.userId },
  });
  return result;
}

/**
 * Called where `claimInvitationsForDestination` is: an EMAIL was just proven by `userId`. Every live
 * staff invitation addressed to it is BOUND to that account. That is a record and nothing more: no
 * role is granted, because a newly registered account has no second factor and the role needs one.
 * The invitee enrols MFA, then accepts with a fresh OTP.
 */
export async function bindStaffInvitationsForDestination(
  tx: Tx,
  deps: Pick<StaffInvitationDeps, 'hasher'>,
  input: { userId: string; canonical: string },
): Promise<number> {
  const bound = await tx
    .update(staffInvitations)
    .set({ boundUserId: input.userId, boundAt: sql`now()` })
    .where(
      and(
        eq(staffInvitations.status, 'PENDING'),
        sql`${staffInvitations.expiresAt} > now()`,
        isNull(staffInvitations.boundUserId),
        eq(staffInvitations.destinationHash, staffInvitationDestinationHash(deps.hasher, input.canonical)),
        // Never the inviter's own address: see the SELF refusal at creation.
        sql`${staffInvitations.invitedBy} <> ${input.userId}`,
      ),
    )
    .returning({ id: staffInvitations.id, roleCode: staffInvitations.roleCode });

  for (const row of bound) {
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.STAFF_INVITATION_BOUND,
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: input.userId,
      subjectUserId: input.userId,
      metadata: { invitationId: row.id, roleCode: row.roleCode },
    });
  }
  return bound.length;
}

/** Daily sweep: a PENDING invitation past its expiry becomes EXPIRED. Batched, skip-locked. */
export async function expireStaffInvitations(
  db: Db,
  options: { batch?: number } = {},
): Promise<{ expired: number }> {
  const batch = options.batch ?? 200;
  let expired = 0;
  for (;;) {
    const swept = await db.transaction(async (tx) => {
      const due = sql`(
        SELECT id FROM identity.staff_invitations
         WHERE status = 'PENDING' AND expires_at <= now()
         ORDER BY expires_at
         LIMIT ${batch}
         FOR UPDATE SKIP LOCKED)`;
      const rows = await tx
        .update(staffInvitations)
        .set({ status: 'EXPIRED' })
        .where(sql`${staffInvitations.id} IN ${due}`)
        .returning({ id: staffInvitations.id });
      return rows.length;
    });
    expired += swept;
    if (swept < batch) return { expired };
  }
}
