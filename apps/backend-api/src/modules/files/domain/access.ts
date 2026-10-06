// Adapted from kumtru/backend-apis/src/modules/files/domain/access.ts (T-001, same shape): the scope
// type comes from @komtru/shared-types and the file types from this module's own schema.
import type { SessionScope } from '@komtru/shared-types';
import type { FileStatus, FileVisibility } from '../infrastructure/postgres/schema/enums.js';

/**
 * The access decision (D2, M20 §6), as a pure function.
 *
 * Everything it needs is passed in — the file's class, who is asking, and what grants they hold — so
 * it is exhaustively testable without a database, a session or a Cloudinary account. That matters
 * more here than in most domain files: this is the one function in the module whose bugs are data
 * breaches, and it is the reason M20 was specified last (§0), once every consumer's real access need
 * was on paper.
 */

export interface AccessSubject {
  userId: string;
  scope: SessionScope;
  /** Live staff role grants, re-resolved per request by identity. Empty for a consumer session. */
  roles: readonly string[];
}

export interface AccessTarget {
  visibility: FileVisibility;
  status: FileStatus;
  uploaderUserId: string;
  /** Active (non-revoked) grants on this file. */
  grantedUserIds: readonly string[];
  grantedRoles: readonly string[];
}

export type AccessDenial =
  | 'TOMBSTONED'
  | 'NOT_OWNER'
  | 'NOT_A_PARTY'
  | 'STAFF_ONLY'
  /** A visibility the decision table does not cover — impossible today, and a fail-closed default. */
  | 'UNKNOWN_VISIBILITY';

export type AccessDecision = { allowed: true } | { allowed: false; reason: AccessDenial };

const ALLOW: AccessDecision = { allowed: true };

const deny = (reason: AccessDenial): AccessDecision => ({ allowed: false, reason });

/**
 * Decides whether `subject` may retrieve `target`.
 *
 * Two rules apply BEFORE visibility is even consulted:
 *
 *  1. A tombstoned file is unreachable by everyone, including staff and including its own uploader.
 *     The row survives so a soft ref still resolves to "this existed and was removed" (D4); the bytes
 *     do not, and in most cases are already destroyed in Cloudinary.
 *  2. The uploader always reaches their own file. Without this, a user who uploaded dispute evidence
 *     could be locked out of it the moment the case closed and its grants were revoked.
 */
export const decideAccess = (subject: AccessSubject, target: AccessTarget): AccessDecision => {
  if (target.status === 'TOMBSTONED') return deny('TOMBSTONED');

  if (target.uploaderUserId === subject.userId) return ALLOW;

  switch (target.visibility) {
    case 'PUBLIC':
      return ALLOW;

    case 'PRIVATE_OWNER':
      // The uploader case above is the only way in. Staff do NOT get an implicit override here:
      // reading a user's own KYC document is what an explicit grant and an audit row are for, not a
      // role check buried in a switch statement.
      return deny('NOT_OWNER');

    case 'PRIVATE_CASE': {
      if (target.grantedUserIds.includes(subject.userId)) return ALLOW;

      // Role grants are STAFF-only. `roles` is empty for a consumer session by construction, so this
      // is belt-and-braces — but the grant table stores a bare role string, and if a consumer scope
      // ever gained roles, a DISPUTE_REVIEWER grant would silently admit them.
      if (subject.scope === 'STAFF' && target.grantedRoles.some((role) => subject.roles.includes(role))) {
        return ALLOW;
      }

      return deny('NOT_A_PARTY');
    }

    case 'INTERNAL_ONLY':
      return subject.scope === 'STAFF' ? ALLOW : deny('STAFF_ONLY');

    default:
      return deny('UNKNOWN_VISIBILITY');
  }
};

/**
 * Human-readable refusals. Uniformly vague on purpose: distinguishing "no such file" from "not yours"
 * turns retrieval into an existence oracle over every file id in the system, which for
 * DISPUTE_EVIDENCE leaks that a dispute exists at all.
 */
export const DENIAL_MESSAGE: Readonly<Record<AccessDenial, string>> = Object.freeze({
  TOMBSTONED: 'This file is no longer available.',
  NOT_OWNER: 'You do not have access to this file.',
  NOT_A_PARTY: 'You do not have access to this file.',
  STAFF_ONLY: 'You do not have access to this file.',
  UNKNOWN_VISIBILITY: 'You do not have access to this file.',
});
