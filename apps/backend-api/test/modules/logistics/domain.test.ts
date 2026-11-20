// The logistics module's pure rules (T-086): who may manage a roster, how a membership moves, the
// LAST_ADMIN guard, and how an invite contact is canonicalised and hashed.
import { describe, expect, it } from 'vitest';
import {
  canManageMembers,
  canTransitionMember,
  wouldOrphanCompany,
  type RosterAdmin,
} from '../../../src/modules/logistics/domain/membership.js';
import {
  invitationDestinationHash,
  invitationExpiry,
  parseInviteContact,
} from '../../../src/modules/logistics/domain/contact.js';
import { normaliseCompanyName } from '../../../src/modules/logistics/domain/company.js';
import { createHmacHasher } from '../../../src/platform/crypto/hmac.js';

const member = (id: string, role: RosterAdmin['role'], status: RosterAdmin['status']): RosterAdmin => ({
  id,
  role,
  status,
});

describe('membership rules', () => {
  it('lets only an ADMIN manage the roster', () => {
    expect(canManageMembers('ADMIN')).toBe(true);
    expect(canManageMembers('OPERATOR')).toBe(false);
  });

  it('moves INVITED to ACTIVE only by login, and treats REMOVED as terminal', () => {
    expect(canTransitionMember('INVITED', 'ACTIVE')).toBe(true);
    expect(canTransitionMember('INVITED', 'REMOVED')).toBe(true);
    expect(canTransitionMember('ACTIVE', 'REMOVED')).toBe(true);
    expect(canTransitionMember('ACTIVE', 'INVITED')).toBe(false);
    expect(canTransitionMember('REMOVED', 'ACTIVE')).toBe(false);
    expect(canTransitionMember('REMOVED', 'INVITED')).toBe(false);
  });
});

describe('wouldOrphanCompany (409 LAST_ADMIN)', () => {
  const roster = [member('a', 'ADMIN', 'ACTIVE'), member('o', 'OPERATOR', 'ACTIVE')];

  it('refuses removing or demoting the only active admin', () => {
    expect(wouldOrphanCompany(roster, 'a', { kind: 'REMOVE' })).toBe(true);
    expect(wouldOrphanCompany(roster, 'a', { kind: 'ROLE', role: 'OPERATOR' })).toBe(true);
  });

  it('allows it once another active admin exists', () => {
    const two = [...roster, member('b', 'ADMIN', 'ACTIVE')];
    expect(wouldOrphanCompany(two, 'a', { kind: 'REMOVE' })).toBe(false);
    expect(wouldOrphanCompany(two, 'a', { kind: 'ROLE', role: 'OPERATOR' })).toBe(false);
  });

  it('does not count a pending admin, who may never sign in, as the admin left behind', () => {
    const pending = [...roster, member('p', 'ADMIN', 'INVITED')];
    expect(wouldOrphanCompany(pending, 'a', { kind: 'REMOVE' })).toBe(true);
    // ...but the active admin may still withdraw the pending one.
    expect(wouldOrphanCompany(pending, 'p', { kind: 'REMOVE' })).toBe(false);
  });

  it('never blocks a change to an operator, or keeping an admin an admin', () => {
    expect(wouldOrphanCompany(roster, 'o', { kind: 'REMOVE' })).toBe(false);
    expect(wouldOrphanCompany(roster, 'a', { kind: 'ROLE', role: 'ADMIN' })).toBe(false);
    expect(wouldOrphanCompany(roster, 'missing', { kind: 'REMOVE' })).toBe(false);
  });
});

describe('invite contacts', () => {
  const hasher = createHmacHasher('a-test-pepper-that-is-long-enough-1234');

  it('canonicalises an email the way identity does, and masks it', () => {
    const contact = parseInviteContact({ email: '  J.Ane+courier@Gmail.com ' });
    expect(contact).toEqual({
      channel: 'EMAIL',
      address: 'j.ane+courier@gmail.com',
      canonical: 'jane@gmail.com',
      masked: 'j•••@gmail.com',
    });
  });

  it('canonicalises a Nigerian phone to E.164', () => {
    expect(parseInviteContact({ phone: '0803 123 4567' })).toMatchObject({
      channel: 'PHONE',
      address: '+2348031234567',
      canonical: '+2348031234567',
    });
  });

  it('refuses a value that is neither', () => {
    expect(parseInviteContact({ email: 'not an email' })).toBeNull();
    expect(parseInviteContact({ phone: '12' })).toBeNull();
    expect(parseInviteContact({})).toBeNull();
  });

  it('hashes under its own domain, keyed, with the channel inside the value', () => {
    const email = invitationDestinationHash(hasher, 'EMAIL', 'jane@gmail.com');
    expect(email.equals(invitationDestinationHash(hasher, 'EMAIL', 'jane@gmail.com'))).toBe(true);
    expect(email.equals(invitationDestinationHash(hasher, 'PHONE', 'jane@gmail.com'))).toBe(false);
    const other = createHmacHasher('another-pepper-that-is-long-enough-12345');
    expect(email.equals(invitationDestinationHash(other, 'EMAIL', 'jane@gmail.com'))).toBe(false);
  });

  it('expires a pending invitation after seven days', () => {
    const from = new Date('2026-11-20T00:00:00Z');
    expect(invitationExpiry(from).toISOString()).toBe('2026-11-27T00:00:00.000Z');
  });
});

describe('company names', () => {
  it('trims and collapses whitespace', () => {
    expect(normaliseCompanyName('  Swift   Couriers  Ltd ')).toBe('Swift Couriers Ltd');
  });
});
