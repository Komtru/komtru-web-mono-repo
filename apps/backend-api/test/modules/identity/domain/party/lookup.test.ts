import { describe, expect, it } from 'vitest';
import {
  canInviteOn,
  escapeLikePrefix,
  lookupKeyForEmail,
  lookupKeyForPhone,
  lookupKeyForUsername,
  partyVisible,
  typeaheadPrefix,
  type Discoverability,
} from '../../../../../src/modules/identity/domain/party/lookup.js';

const row = (overrides: Partial<Discoverability> = {}): Discoverability => ({
  status: 'ACTIVE',
  discoverableByUsername: true,
  discoverableByEmail: true,
  discoverableByPhone: true,
  ...overrides,
});

describe('lookup keys (M1 §8.1)', () => {
  it('canonicalises an email to the form the verified-uniqueness index covers', () => {
    expect(lookupKeyForEmail('J.ane+shop@GoogleMail.com')).toEqual({
      channel: 'EMAIL',
      canonical: 'jane@gmail.com',
    });
  });

  it('canonicalises a Nigerian local number to E.164', () => {
    expect(lookupKeyForPhone('0802 341 5567')).toEqual({
      channel: 'PHONE',
      canonical: '+2348023415567',
    });
  });

  it('strips the sigil and folds case on a handle', () => {
    expect(lookupKeyForUsername('@JaneDoe')).toEqual({ channel: 'USERNAME', canonical: 'janedoe' });
  });

  it('returns null for a value that cannot be canonicalised', () => {
    expect(lookupKeyForEmail('nope')).toBeNull();
    expect(lookupKeyForPhone('nope')).toBeNull();
    expect(lookupKeyForUsername('@')).toBeNull();
    expect(lookupKeyForUsername('   ')).toBeNull();
  });

  it('says a username miss cannot be invited and the other two can', () => {
    // §8.1: party_invitations needs a deliverable destination, and a handle is not one.
    expect(canInviteOn('USERNAME')).toBe(false);
    expect(canInviteOn('EMAIL')).toBe(true);
    expect(canInviteOn('PHONE')).toBe(true);
  });
});

describe('partyVisible (M1 §8.3 controls 5 and 8)', () => {
  it('shows an ACTIVE user whose channel flag is on', () => {
    expect(partyVisible(row(), 'EMAIL')).toBe(true);
  });

  it('hides a user whose flag for the queried channel is off', () => {
    expect(partyVisible(row({ discoverableByEmail: false }), 'EMAIL')).toBe(false);
  });

  it('hides on the queried channel only', () => {
    const hidden = row({ discoverableByEmail: false });
    expect(partyVisible(hidden, 'USERNAME')).toBe(true);
    expect(partyVisible(hidden, 'PHONE')).toBe(true);
  });

  it.each(['SUSPENDED', 'CLOSED', 'LOCKED', 'RESTRICTED', 'ANONYMISED', 'PENDING_VERIFICATION'])(
    'hides a %s user, so lookup cannot probe an enforcement action',
    (status) => {
      expect(partyVisible(row({ status }), 'USERNAME')).toBe(false);
    },
  );
});

describe('typeahead (M1 §8.4)', () => {
  it('refuses a prefix below three characters', () => {
    expect(typeaheadPrefix('ja')).toBeNull();
    expect(typeaheadPrefix('@ja')).toBeNull();
    expect(typeaheadPrefix('')).toBeNull();
  });

  it('strips the sigil, folds case and trims', () => {
    expect(typeaheadPrefix('  @JaN ')).toBe('jan');
  });

  it('escapes the LIKE metacharacters so a wildcard cannot walk the namespace', () => {
    expect(escapeLikePrefix('a%_\\b')).toBe('a\\%\\_\\\\b');
  });

  it('leaves an ordinary prefix untouched', () => {
    expect(escapeLikePrefix('jane.doe_1')).toBe('jane.doe\\_1');
  });
});
