// A person's membership of a logistics company (m2 §2, §3), and the rules that decide what may change.
//
// A POC role is not a staff permission: it is this module's own small authorization model, checked
// in the portal's controllers against the principal's re-resolved membership. Nothing here touches a
// `users` row — removing someone from a company leaves their Komtru account exactly as it was.

export const MEMBER_ROLES = ['ADMIN', 'OPERATOR'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBER_STATUSES = ['INVITED', 'ACTIVE', 'REMOVED'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/** A membership that still counts: invited (login pending) or active. */
export const LIVE_MEMBER_STATUSES: readonly MemberStatus[] = ['INVITED', 'ACTIVE'];

/** Only a company ADMIN manages the roster (m2 §5b); an OPERATOR may read it. */
export const canManageMembers = (role: MemberRole): boolean => role === 'ADMIN';

/**
 * The membership lifecycle. Login is acceptance (m2 §2): `INVITED → ACTIVE` happens on the first
 * successful logistics sign-in and nowhere else. `REMOVED` is terminal — a person who comes back is
 * invited again, which writes a new row and keeps the old one as history.
 */
const TRANSITIONS: Record<MemberStatus, readonly MemberStatus[]> = {
  INVITED: ['ACTIVE', 'REMOVED'],
  ACTIVE: ['REMOVED'],
  REMOVED: [],
};

export const canTransitionMember = (from: MemberStatus, to: MemberStatus): boolean =>
  TRANSITIONS[from].includes(to);

export interface RosterAdmin {
  id: string;
  role: MemberRole;
  status: MemberStatus;
}

export type MemberChange = { kind: 'ROLE'; role: MemberRole } | { kind: 'REMOVE' };

/**
 * `409 LAST_ADMIN` (m2 §3): would this change leave the company with no live ADMIN? Without the guard
 * a company could lock itself out of managing its own roster for good.
 *
 * Only an ACTIVE admin counts as the one left behind. An INVITED admin may never sign in, so a company
 * whose only remaining admin is a pending invitation is already locked out. The caller passes the company's live roster read under a lock on the company row, so two admins
 * demoting each other at the same moment cannot both pass.
 */
export function wouldOrphanCompany(
  roster: readonly RosterAdmin[],
  targetId: string,
  change: MemberChange,
): boolean {
  const target = roster.find((member) => member.id === targetId);
  if (!target || target.role !== 'ADMIN' || !LIVE_MEMBER_STATUSES.includes(target.status)) return false;
  if (change.kind === 'ROLE' && change.role === 'ADMIN') return false;
  const otherAdmins = roster.filter(
    (member) => member.id !== targetId && member.role === 'ADMIN' && member.status === 'ACTIVE',
  );
  return otherAdmins.length === 0;
}
