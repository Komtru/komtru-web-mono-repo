// The one function in this module whose bugs are data breaches (M20 §0, D2, §6). Pure, so every
// branch is exercised here without a database, a session or a Cloudinary account.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decideAccess,
  type AccessSubject,
  type AccessTarget,
} from '../../../../src/modules/files/domain/access.js';

const UPLOADER = randomUUID();
const STRANGER = randomUUID();

const subject = (overrides: Partial<AccessSubject> = {}): AccessSubject => ({
  userId: STRANGER,
  scope: 'CONSUMER',
  roles: [],
  ...overrides,
});

const target = (overrides: Partial<AccessTarget> = {}): AccessTarget => ({
  visibility: 'PRIVATE_OWNER',
  status: 'ACTIVE',
  uploaderUserId: UPLOADER,
  grantedUserIds: [],
  grantedRoles: [],
  ...overrides,
});

describe('decideAccess', () => {
  it('refuses a tombstoned file to everyone, its own uploader and staff included', () => {
    // The row survives so a soft ref still resolves to "this existed and was removed" (D4); the bytes
    // do not, and in most cases are already destroyed in Cloudinary.
    const tombstoned = target({ status: 'TOMBSTONED', visibility: 'PUBLIC' });
    expect(decideAccess(subject({ userId: UPLOADER }), tombstoned)).toEqual({
      allowed: false,
      reason: 'TOMBSTONED',
    });
    expect(decideAccess(subject({ scope: 'STAFF', roles: ['SUPER_ADMIN'] }), tombstoned)).toEqual({
      allowed: false,
      reason: 'TOMBSTONED',
    });
  });

  it('always lets the uploader reach their own file', () => {
    // Without this, a user who uploaded dispute evidence is locked out of it the moment the case
    // closes and its grants are revoked.
    expect(decideAccess(subject({ userId: UPLOADER }), target({ visibility: 'PRIVATE_CASE' }))).toEqual({
      allowed: true,
    });
  });

  it('serves a PUBLIC file to a stranger', () => {
    expect(decideAccess(subject(), target({ visibility: 'PUBLIC' }))).toEqual({ allowed: true });
  });

  it('refuses a PRIVATE_OWNER file to staff, whatever roles they hold', () => {
    // Reading a user's own KYC document is what a grant and an audit row are for, not a role check
    // buried in a switch statement.
    expect(
      decideAccess(subject({ scope: 'STAFF', roles: ['SUPER_ADMIN', 'KYC_ANALYST'] }), target()),
    ).toEqual({ allowed: false, reason: 'NOT_OWNER' });
  });

  describe('a KYC reviewer grant on a PRIVATE_OWNER file (T-055)', () => {
    it('admits a staff session holding a granted role', () => {
      expect(
        decideAccess(
          subject({ scope: 'STAFF', roles: ['KYC_ANALYST'] }),
          target({ grantedRoles: ['KYC_ANALYST', 'OPERATIONS_ADMIN'] }),
        ),
      ).toEqual({ allowed: true });
    });

    it('still refuses staff whose roles are not the granted ones', () => {
      expect(
        decideAccess(
          subject({ scope: 'STAFF', roles: ['DISPUTE_REVIEWER'] }),
          target({ grantedRoles: ['KYC_ANALYST'] }),
        ),
      ).toEqual({ allowed: false, reason: 'NOT_OWNER' });
    });

    it('never admits a consumer session, even one that somehow carries the role', () => {
      expect(
        decideAccess(
          subject({ scope: 'CONSUMER', roles: ['KYC_ANALYST'] }),
          target({ grantedRoles: ['KYC_ANALYST'] }),
        ),
      ).toEqual({ allowed: false, reason: 'NOT_OWNER' });
    });

    it('does not read a user-id grant as a way in: the owner is the only person', () => {
      expect(decideAccess(subject(), target({ grantedUserIds: [STRANGER] }))).toEqual({
        allowed: false,
        reason: 'NOT_OWNER',
      });
    });
  });

  it('admits a PRIVATE_CASE grantee named by user id', () => {
    expect(
      decideAccess(subject(), target({ visibility: 'PRIVATE_CASE', grantedUserIds: [STRANGER] })),
    ).toEqual({ allowed: true });
  });

  it('refuses a PRIVATE_CASE file to someone with no grant', () => {
    expect(decideAccess(subject(), target({ visibility: 'PRIVATE_CASE' }))).toEqual({
      allowed: false,
      reason: 'NOT_A_PARTY',
    });
  });

  it('honours a role grant only on a staff session', () => {
    // The grant table stores a bare role string. If a consumer scope ever gained roles, a
    // DISPUTE_REVIEWER grant would silently admit them.
    const caseFile = target({ visibility: 'PRIVATE_CASE', grantedRoles: ['DISPUTE_REVIEWER'] });
    expect(decideAccess(subject({ scope: 'STAFF', roles: ['DISPUTE_REVIEWER'] }), caseFile)).toEqual({
      allowed: true,
    });
    expect(decideAccess(subject({ scope: 'CONSUMER', roles: ['DISPUTE_REVIEWER'] }), caseFile)).toEqual({
      allowed: false,
      reason: 'NOT_A_PARTY',
    });
  });

  it('gives INTERNAL_ONLY to staff and to nobody else', () => {
    const internal = target({ visibility: 'INTERNAL_ONLY' });
    expect(decideAccess(subject({ scope: 'STAFF' }), internal)).toEqual({ allowed: true });
    expect(decideAccess(subject({ scope: 'CONSUMER' }), internal)).toEqual({
      allowed: false,
      reason: 'STAFF_ONLY',
    });
    expect(decideAccess(subject({ scope: 'LOGISTICS' }), internal)).toEqual({
      allowed: false,
      reason: 'STAFF_ONLY',
    });
  });

  it('fails closed on a visibility the decision table does not cover', () => {
    const unknown = { ...target(), visibility: 'SOMETHING_NEW' } as unknown as AccessTarget;
    expect(decideAccess(subject(), unknown)).toEqual({ allowed: false, reason: 'UNKNOWN_VISIBILITY' });
  });
});
