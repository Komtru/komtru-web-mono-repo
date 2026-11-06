// Staff invitations (T-038, M1 §5.10's shape applied to §5.7's roles): inviting someone to hold a
// staff role before they have, or have proven, an account.
//
// The destination is stored the way a party invitation stores it (hashed, masked, sealed — never in
// clear) under a domain of its own, so a leaked row from this table confirms nothing against
// `party_invitations` or `otp_challenges`. The role is granted at ACCEPTANCE, through the same
// `insertAssignment` every other grant uses; nothing in this file grants anything.
import { sha256, type HmacHasher } from '../../../platform/crypto/hmac.js';
import { randomToken } from '../../../platform/crypto/random.js';
import { validateRoleGrant } from './rbac/sod.js';

/** Shorter than a party invitation's 14 days: this one ends in a staff role, so it should not linger. */
export const STAFF_INVITATION_TTL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export const STAFF_INVITATION_DESTINATION_DOMAIN = 'identity:staff-invitation:destination';

/** Unkeyed SHA-256, for the reason `domain/invitation.ts` gives: 256 random bits have nothing to brute-force. */
export const issueStaffInvitationToken = (): { token: string; tokenHash: Buffer } => {
  const token = randomToken();
  return { token, tokenHash: sha256(token) };
};

export const staffInvitationTokenHash = (token: string): Buffer => sha256(token);

export const staffInvitationExpiry = (from: Date): Date =>
  new Date(from.getTime() + STAFF_INVITATION_TTL_DAYS * DAY_MS);

export const staffInvitationDestinationHash = (hasher: HmacHasher, canonical: string): Buffer =>
  hasher.hmac(STAFF_INVITATION_DESTINATION_DOMAIN, canonical);

/** Stands in for the grantee, who is unknown (and may not exist) when the invitation is written. */
const UNKNOWN_GRANTEE = '00000000-0000-4000-8000-000000000001';
const UNKNOWN_GRANTER = '00000000-0000-4000-8000-000000000002';

export type StaffInvitationVerdict =
  { ok: true; grantExpiresAt: Date | null } | { ok: false; reason: 'UNKNOWN_ROLE' | 'INVALID_EXPIRY' };

/**
 * What can be checked at invitation time. It reuses `validateRoleGrant` rather than restating it, so
 * the catalogue and the one-year box cannot drift from the grant that finally runs; that grant
 * re-validates at acceptance, which is the check that counts. A dual-approval role is accepted here
 * on purpose: its second approver is found when the invitee accepts.
 */
export function validateStaffInvitation(input: {
  roleCode: string;
  grantExpiresAt?: Date | undefined;
  now: Date;
}): StaffInvitationVerdict {
  const verdict = validateRoleGrant({
    roleCode: input.roleCode,
    userId: UNKNOWN_GRANTEE,
    grantedBy: UNKNOWN_GRANTER,
    ...(input.grantExpiresAt ? { expiresAt: input.grantExpiresAt } : {}),
    now: input.now,
  });
  if (!verdict.ok) {
    return { ok: false, reason: verdict.reason === 'UNKNOWN_ROLE' ? 'UNKNOWN_ROLE' : 'INVALID_EXPIRY' };
  }
  return { ok: true, grantExpiresAt: input.grantExpiresAt ?? null };
}

export type StaffInvitationStatus = 'PENDING' | 'CLAIMED' | 'EXPIRED' | 'CANCELLED';

/** Live means pending AND unexpired by the clock: the sweep runs daily, so `status` alone lags. */
export const canAcceptStaffInvitation = (
  invitation: { status: StaffInvitationStatus; expiresAt: Date },
  now: Date,
): boolean => invitation.status === 'PENDING' && invitation.expiresAt.getTime() > now.getTime();
