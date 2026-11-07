// M1 §9.1 as a table: every pair of statuses, so a new edge has to be added on purpose.
import { describe, expect, it } from 'vitest';
import {
  LIFECYCLE_STATUSES,
  isStatusUsable,
  staffPermissionFor,
  transitionAllowed,
  type Initiator,
  type LifecycleStatus,
} from '../../../../src/modules/identity/domain/lifecycle.js';
import { userStatus } from '../../../../src/modules/identity/infrastructure/postgres/schema/enums.js';

const EDGES: Record<string, Initiator[]> = {
  'PENDING_VERIFICATION>ACTIVE': ['SYSTEM'],
  'PENDING_VERIFICATION>CLOSED': ['SYSTEM', 'SELF'],
  'PENDING_VERIFICATION>SUSPENDED': ['SYSTEM'],
  'ACTIVE>RESTRICTED': ['STAFF', 'SYSTEM'],
  'ACTIVE>SUSPENDED': ['STAFF', 'SYSTEM'],
  'ACTIVE>LOCKED': ['SYSTEM'],
  'ACTIVE>CLOSED': ['SELF', 'STAFF'],
  'RESTRICTED>ACTIVE': ['STAFF'],
  'RESTRICTED>SUSPENDED': ['STAFF', 'SYSTEM'],
  'SUSPENDED>ACTIVE': ['STAFF'],
  'SUSPENDED>CLOSED': ['STAFF'],
  'LOCKED>ACTIVE': ['STAFF', 'SYSTEM'],
  'CLOSED>ANONYMISED': ['SYSTEM'],
};

describe('M1 section 9.1 status machine', () => {
  it('knows exactly the statuses the database enum has', () => {
    expect([...LIFECYCLE_STATUSES].sort()).toEqual([...userStatus.enumValues].sort());
  });

  it('allows exactly the documented edges, for exactly the documented initiators', () => {
    for (const from of LIFECYCLE_STATUSES) {
      for (const to of LIFECYCLE_STATUSES) {
        for (const by of ['STAFF', 'SYSTEM', 'SELF'] as const) {
          const expected = EDGES[`${from}>${to}`]?.includes(by) ?? false;
          expect(transitionAllowed(from, to, by), `${from} > ${to} by ${by}`).toBe(expected);
        }
      }
    }
  });

  it('never leaves ANONYMISED and never returns to PENDING_VERIFICATION', () => {
    for (const to of LIFECYCLE_STATUSES) {
      for (const by of ['STAFF', 'SYSTEM', 'SELF'] as const) {
        expect(transitionAllowed('ANONYMISED', to, by)).toBe(false);
        expect(transitionAllowed(to, 'PENDING_VERIFICATION', by)).toBe(false);
      }
    }
  });

  it('maps each staff-reachable target to the RBAC permission that guards it', () => {
    expect(staffPermissionFor('RESTRICTED')).toBe('user.restrict');
    expect(staffPermissionFor('SUSPENDED')).toBe('user.suspend');
    expect(staffPermissionFor('ACTIVE')).toBe('user.reinstate');
    expect(staffPermissionFor('CLOSED')).toBe('user.close');
    expect(staffPermissionFor('LOCKED')).toBeUndefined();
    expect(staffPermissionFor('ANONYMISED')).toBeUndefined();
  });

  it('agrees with the session layer on which statuses may hold a session', () => {
    const usable = LIFECYCLE_STATUSES.filter((s: LifecycleStatus) => isStatusUsable(s));
    expect([...usable].sort()).toEqual(['ACTIVE', 'PENDING_VERIFICATION', 'RESTRICTED']);
  });
});
