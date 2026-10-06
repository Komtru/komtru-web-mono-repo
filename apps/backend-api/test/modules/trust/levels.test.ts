// The level arithmetic, as pure functions.
//
// This file exists because of a review finding: `grantLevel` wrote identity's column BEFORE it
// checked whether the user was already above the target, which silently downgraded a
// BUSINESS_VERIFIED user to IDENTITY_VERIFIED and appended no audit row — the exact disagreement
// between the column and the append-only log that the log exists to prevent. The decision is pulled
// out here so it is provable without a database, and so the store can only write after asking it.
import { describe, expect, it } from 'vitest';
import {
  LEVEL_NAMES,
  decideLevelChange,
  earnedIdentityLevel,
  levelName,
  levelNumber,
} from '../../../src/modules/trust/domain/levels.js';

describe('the ladder', () => {
  it('indexes M6 §4 by its numeric level', () => {
    expect([...LEVEL_NAMES]).toEqual([
      'UNVERIFIED',
      'CONTACT_VERIFIED',
      'IDENTITY_VERIFIED',
      'BUSINESS_VERIFIED',
      'ENHANCED',
    ]);
  });

  it('round-trips a name and a number', () => {
    expect(levelName(levelNumber('IDENTITY_VERIFIED'))).toBe('IDENTITY_VERIFIED');
  });

  it('refuses a level it does not know rather than guessing zero', () => {
    expect(() => levelNumber('SOMETHING_ELSE')).toThrow(/SOMETHING_ELSE/);
    expect(() => levelName(9)).toThrow(/9/);
  });
});

describe('decideLevelChange', () => {
  it('grants upward', () => {
    expect(decideLevelChange({ from: 1, to: 2, direction: 'GRANT' })).toEqual({ apply: true });
  });

  it('does nothing when the user already holds the level', () => {
    expect(decideLevelChange({ from: 2, to: 2, direction: 'GRANT' })).toEqual({ apply: false });
  });

  it('NEVER downgrades through a grant, even for a user above the target', () => {
    // The review finding: a redelivered level-2 job must not pull a BUSINESS_VERIFIED user down.
    expect(decideLevelChange({ from: 3, to: 2, direction: 'GRANT' })).toEqual({ apply: false });
    expect(decideLevelChange({ from: 4, to: 2, direction: 'GRANT' })).toEqual({ apply: false });
  });

  it('revokes downward', () => {
    expect(decideLevelChange({ from: 2, to: 1, direction: 'REVOKE' })).toEqual({ apply: true });
  });

  it('never raises a level through a revocation', () => {
    expect(decideLevelChange({ from: 1, to: 2, direction: 'REVOKE' })).toEqual({ apply: false });
    expect(decideLevelChange({ from: 2, to: 2, direction: 'REVOKE' })).toEqual({ apply: false });
  });
});

describe('earnedIdentityLevel', () => {
  it('needs an identifier AND liveness for level 2', () => {
    expect(earnedIdentityLevel({ identifierVerified: true, livenessPassed: false })).toBe(false);
    expect(earnedIdentityLevel({ identifierVerified: false, livenessPassed: true })).toBe(false);
    expect(earnedIdentityLevel({ identifierVerified: true, livenessPassed: true })).toBe(true);
  });
});
