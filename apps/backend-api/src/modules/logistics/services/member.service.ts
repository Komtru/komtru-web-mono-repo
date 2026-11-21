// A company's POCs (m2 §2, §5a, §5b): invite, list, change a role, remove.
//
// Three rules shape this file.
//
//   1. INVITING NEVER DEAD-ENDS AND NEVER CREATES A `users` ROW. An address a verified account
//      already holds links that account at once (`LINKED`); any other address becomes a pending
//      invitation (`PENDING`) that materialises when its invitee verifies it through identity's
//      ordinary signup (invitation.service.ts). Creating an account from an unproven address is the
//      spoofing vector staff invitations avoid, and this follows the same shape.
//   2. EVERY ROSTER CHANGE LOCKS THE COMPANY ROW FIRST. `409 LAST_ADMIN` is a service-level guard
//      (m2 §3), and two admins demoting each other at the same instant would both pass it without a
//      lock. The lock serialises the roster, so the second one reads the first one's result.
//   3. A PORTAL ADMIN IS RE-CHECKED UNDER THAT LOCK. The principal's role was read when the request
//      arrived; an admin removed a moment ago must not finish a change they started. So every
//      mutation re-reads the caller's own row after the lock (`requireActingAdmin`).
//   4. THE COMPANY IS ALWAYS THE CALLER'S. Every function takes `companyId` from its caller, and the
//      portal controllers take it from the principal's re-resolved membership, never the request.
import { and, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { isUniqueViolation } from '../../../db/errors.js';
import type { Encryption } from '../../../platform/crypto/encryption.js';
import type { HmacHasher } from '../../../platform/crypto/hmac.js';
import { ApiError } from '../../../platform/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { findUserByVerifiedEmail, userPhones } from '../../identity/index.js';
import { LOGISTICS_AUDIT, eventActorFor, writeLogisticsAudit, type LogisticsActor } from './audit.js';
import { invitationDestinationHash, invitationExpiry, type InviteContact } from '../domain/contact.js';
import {
  logisticsInvitationCreated,
  logisticsMemberInvited,
  logisticsMemberRemoved,
  logisticsMemberRoleChanged,
} from '../domain/events.js';
import {
  LIVE_MEMBER_STATUSES,
  canTransitionMember,
  wouldOrphanCompany,
  type MemberChange,
  type MemberRole,
} from '../domain/membership.js';
import {
  logisticsCompanies,
  logisticsCompanyMembers,
  logisticsMemberInvitations,
} from '../infrastructure/postgres/schema/index.js';
import {
  invitationColumns,
  readMember,
  toInvitationView,
  type InvitationView,
  type MemberView,
} from './views.js';

export interface LogisticsCrypto {
  /** The pepper every Komtru HMAC uses, under this module's own domain. */
  hasher: HmacHasher;
  encryption: Encryption;
}

export type InviteOutcome =
  { outcome: 'LINKED'; member: MemberView } | { outcome: 'PENDING'; invitation: InvitationView };

export const notFound = (what = 'member'): ApiError => new ApiError(404, 'NOT_FOUND', `No such ${what}`);

export const lastAdmin = (): ApiError =>
  new ApiError(
    409,
    'LAST_ADMIN',
    'A company needs an admin',
    "You can't remove or demote the only admin. Promote someone else first.",
  );

export const alreadyAMember = (): ApiError =>
  new ApiError(409, 'ALREADY_A_MEMBER', 'Already on the team', 'This person is already on your team.');

export const alreadyInvited = (): ApiError =>
  new ApiError(
    409,
    'CONFLICT',
    'Already invited',
    'This email or phone already has a pending invitation to your team.',
  );

/** Locks the company row for the rest of the transaction; 404 if there is no such company. */
export async function lockCompany(tx: Tx, companyId: string): Promise<{ id: string; name: string }> {
  const row = (
    await tx
      .select({ id: logisticsCompanies.id, name: logisticsCompanies.name })
      .from(logisticsCompanies)
      .where(eq(logisticsCompanies.id, companyId))
      .for('update')
  )[0];
  if (!row) throw notFound('company');
  return row;
}

/**
 * A portal caller must still be an ACTIVE ADMIN of this company, read under the company lock the
 * caller already holds. Staff (behind `logistics.manage`) pass through.
 */
export async function requireActingAdmin(tx: Tx, companyId: string, actor: LogisticsActor): Promise<void> {
  if (actor.kind === 'STAFF') return;
  const row = (
    await tx
      .select({ role: logisticsCompanyMembers.role })
      .from(logisticsCompanyMembers)
      .where(
        and(
          eq(logisticsCompanyMembers.companyId, companyId),
          eq(logisticsCompanyMembers.userId, actor.userId),
          eq(logisticsCompanyMembers.status, 'ACTIVE'),
        ),
      )
  )[0];
  if (row?.role !== 'ADMIN') {
    throw new ApiError(403, 'FORBIDDEN', 'Admins only', 'Only a company admin can change the team');
  }
}

/**
 * The account that provably holds this number NOW. Logistics-only on purpose: a number past its
 * `reverify_after` may have been recycled to someone else (M1 D4), and linking it would hand the
 * previous owner a company membership. Identity's shared lookup keeps its own rule.
 */
export async function findUserByCurrentPhone(tx: Tx, phoneE164: string): Promise<{ userId: string } | null> {
  const row = (
    await tx
      .select({ userId: userPhones.userId })
      .from(userPhones)
      .where(
        and(
          eq(userPhones.phoneE164, phoneE164),
          isNotNull(userPhones.verifiedAt),
          or(isNull(userPhones.reverifyAfter), gt(userPhones.reverifyAfter, sql`now()`)),
        ),
      )
      .limit(1)
  )[0];
  return row ?? null;
}

export interface InviteInput {
  companyId: string;
  role: MemberRole;
  contact: InviteContact;
  /** Null when staff onboard a company: the first POC has no inviter, the company row has a creator. */
  invitedByUserId: string | null;
  actor: LogisticsActor;
}

/** The one invite path, shared by staff onboarding (m2 §5a) and the portal (m2 §5b). */
export async function inviteToCompany(
  tx: Tx,
  crypto: LogisticsCrypto,
  input: InviteInput,
): Promise<InviteOutcome> {
  const company = await lockCompany(tx, input.companyId);
  await requireActingAdmin(tx, company.id, input.actor);
  const { contact } = input;

  const existing =
    contact.channel === 'EMAIL'
      ? await findUserByVerifiedEmail(tx, contact.canonical)
      : await findUserByCurrentPhone(tx, contact.canonical);

  if (existing) {
    let memberId: string;
    try {
      // A savepoint, so the unique violation can be answered as a 409 rather than abort the caller's
      // whole transaction with a 500.
      memberId = await tx.transaction(async (sp) => {
        const row = (
          await sp
            .insert(logisticsCompanyMembers)
            .values({
              companyId: company.id,
              userId: existing.userId,
              role: input.role,
              status: 'INVITED',
              invitedByUserId: input.invitedByUserId,
            })
            .returning({ id: logisticsCompanyMembers.id })
        )[0];
        if (!row) throw new Error('logistics: a member insert returned no row');
        return row.id;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'company_user_live_uidx')) throw alreadyAMember();
      throw error;
    }

    await publish(tx, logisticsMemberInvited, {
      payload: {
        memberId,
        companyId: company.id,
        companyName: company.name,
        userId: existing.userId,
        role: input.role,
        via: 'LINKED',
      },
      aggregateType: 'logistics.company',
      aggregateId: company.id,
      actor: eventActorFor(input.actor),
    });
    await writeLogisticsAudit(tx, input.actor, LOGISTICS_AUDIT.MEMBER_INVITED, {
      companyId: company.id,
      subjectUserId: existing.userId,
      metadata: { memberId, role: input.role, channel: contact.channel },
    });

    const member = await readMember(tx, company.id, memberId);
    if (!member) throw new Error('logistics: a member just written could not be read back');
    return { outcome: 'LINKED', member };
  }

  const destinationHash = invitationDestinationHash(crypto.hasher, contact.channel, contact.canonical);

  // A pending invitation past its expiry still holds the one-pending-per-address index. Retire it
  // first, so inviting the same person again after a week is a new invitation rather than a 409.
  await tx
    .update(logisticsMemberInvitations)
    .set({ status: 'EXPIRED' })
    .where(
      and(
        eq(logisticsMemberInvitations.companyId, company.id),
        eq(logisticsMemberInvitations.destinationHash, destinationHash),
        eq(logisticsMemberInvitations.status, 'PENDING'),
        lte(logisticsMemberInvitations.expiresAt, sql`now()`),
      ),
    );

  let invitation;
  try {
    invitation = await tx.transaction(async (sp) => {
      const row = (
        await sp
          .insert(logisticsMemberInvitations)
          .values({
            companyId: company.id,
            role: input.role,
            channel: contact.channel,
            destinationHash,
            destinationMasked: contact.masked,
            destinationEnc: crypto.encryption.seal(contact.address),
            invitedByUserId: input.invitedByUserId,
            expiresAt: invitationExpiry(new Date()),
          })
          .returning(invitationColumns)
      )[0];
      if (!row) throw new Error('logistics: an invitation insert returned no row');
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'member_invitations_pending_uidx')) throw alreadyInvited();
    throw error;
  }

  await publish(tx, logisticsInvitationCreated, {
    payload: {
      invitationId: invitation.id,
      companyId: company.id,
      role: input.role,
      channel: contact.channel,
    },
    aggregateType: 'logistics.company',
    aggregateId: company.id,
    actor: eventActorFor(input.actor),
  });
  await writeLogisticsAudit(tx, input.actor, LOGISTICS_AUDIT.INVITATION_CREATED, {
    companyId: company.id,
    // The masked address only: an audit row is kept, and §S12 keeps clear contacts out of what we keep.
    metadata: {
      invitationId: invitation.id,
      role: input.role,
      channel: contact.channel,
      contact: contact.masked,
    },
  });

  return { outcome: 'PENDING', invitation: toInvitationView(invitation) };
}

export interface UpdateMemberInput {
  companyId: string;
  memberId: string;
  change: MemberChange;
  actor: LogisticsActor;
}

/**
 * A role change or a removal (m2 §5b `PATCH /logistics/members/:id`). Never touches `users`: a
 * removed POC keeps their Komtru account, and only loses this company.
 */
export async function updateMember(tx: Tx, input: UpdateMemberInput): Promise<MemberView> {
  await lockCompany(tx, input.companyId);
  await requireActingAdmin(tx, input.companyId, input.actor);

  const roster = await tx
    .select({
      id: logisticsCompanyMembers.id,
      userId: logisticsCompanyMembers.userId,
      role: logisticsCompanyMembers.role,
      status: logisticsCompanyMembers.status,
    })
    .from(logisticsCompanyMembers)
    .where(
      and(
        eq(logisticsCompanyMembers.companyId, input.companyId),
        inArray(logisticsCompanyMembers.status, [...LIVE_MEMBER_STATUSES]),
      ),
    );

  const target = roster.find((member) => member.id === input.memberId);
  if (!target) {
    // A REMOVED row of this company is a 409 (nothing left to change); anything else, including a
    // member of a different company, is the same 404 a member that never existed gets.
    const removed = (
      await tx
        .select({ id: logisticsCompanyMembers.id })
        .from(logisticsCompanyMembers)
        .where(
          and(
            eq(logisticsCompanyMembers.companyId, input.companyId),
            eq(logisticsCompanyMembers.id, input.memberId),
          ),
        )
    )[0];
    if (removed) {
      throw new ApiError(
        409,
        'INVALID_TRANSITION',
        'Already removed',
        'This person is no longer on your team.',
      );
    }
    throw notFound();
  }

  if (wouldOrphanCompany(roster, target.id, input.change)) throw lastAdmin();

  if (input.change.kind === 'REMOVE') {
    if (!canTransitionMember(target.status, 'REMOVED')) {
      throw new ApiError(409, 'INVALID_TRANSITION', 'Cannot remove', 'This person cannot be removed.');
    }
    await tx
      .update(logisticsCompanyMembers)
      .set({ status: 'REMOVED', removedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(logisticsCompanyMembers.id, target.id));
    await publish(tx, logisticsMemberRemoved, {
      payload: { memberId: target.id, companyId: input.companyId, userId: target.userId },
      aggregateType: 'logistics.company',
      aggregateId: input.companyId,
      actor: eventActorFor(input.actor),
    });
    await writeLogisticsAudit(tx, input.actor, LOGISTICS_AUDIT.MEMBER_REMOVED, {
      companyId: input.companyId,
      subjectUserId: target.userId,
      metadata: { memberId: target.id, role: target.role, fromStatus: target.status },
    });
  } else if (input.change.role !== target.role) {
    await tx
      .update(logisticsCompanyMembers)
      .set({ role: input.change.role, updatedAt: sql`now()` })
      .where(eq(logisticsCompanyMembers.id, target.id));
    await publish(tx, logisticsMemberRoleChanged, {
      payload: {
        memberId: target.id,
        companyId: input.companyId,
        userId: target.userId,
        from: target.role,
        to: input.change.role,
      },
      aggregateType: 'logistics.company',
      aggregateId: input.companyId,
      actor: eventActorFor(input.actor),
    });
    await writeLogisticsAudit(tx, input.actor, LOGISTICS_AUDIT.MEMBER_ROLE_CHANGED, {
      companyId: input.companyId,
      subjectUserId: target.userId,
      metadata: { memberId: target.id, from: target.role, to: input.change.role },
    });
  }

  const member = await readMember(tx, input.companyId, target.id);
  if (!member) throw new Error('logistics: a member just written could not be read back');
  return member;
}
