// M1 §6.1 and §6.4. The application rule is authoritative; the database CHECK is a looser backstop.
import { describe, expect, it } from 'vitest';
import {
  CHANGE_COOLDOWN_DAYS,
  LIFETIME_CHANGE_CAP,
  OWNER_RECLAIM_DAYS,
  QUARANTINE_DAYS,
  SUPPORT_APPROVAL_LEVELS,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  normaliseUsername,
  validateUsernameFormat,
} from '../../../../../src/modules/identity/domain/username/policy.js';

describe('username policy', () => {
  it('normalises what a user types into the canonical form', () => {
    expect(normaliseUsername('  @JaneDoe ')).toBe('janedoe');
    expect(normaliseUsername('ｊａｎｅ')).toBe('jane');
    expect(normaliseUsername('@@jane')).toBe('@jane');
  });

  it.each([
    ['janedoe', true],
    ['jane.doe', true],
    ['jane_doe_ng', true],
    ['a1b', true],
    ['jane2', true],
    ['a'.repeat(30), true],
    ['ab', false],
    ['a'.repeat(31), false],
    ['1janedoe', false],
    ['123456', false],
    ['jane.', false],
    ['jane_', false],
    ['.jane', false],
    ['jane__doe', false],
    ['jane._doe', false],
    ['jane-doe', false],
    ['jane doe', false],
    ['jané', false],
    ['janеdoe', false],
  ])('validates %s as %s', (value, ok) => {
    expect(validateUsernameFormat(value).ok).toBe(ok);
  });

  it('names the problem so the caller can say which rule fired', () => {
    expect(validateUsernameFormat('ab')).toEqual({ ok: false, problem: 'TOO_SHORT' });
    expect(validateUsernameFormat('a'.repeat(31))).toEqual({ ok: false, problem: 'TOO_LONG' });
    expect(validateUsernameFormat('jané')).toEqual({ ok: false, problem: 'NON_ASCII' });
    expect(validateUsernameFormat('jane__doe')).toEqual({ ok: false, problem: 'INVALID_FORMAT' });
  });

  it('accepts mixed case by normalising it, never by passing it through', () => {
    expect(validateUsernameFormat('JaneDoe')).toEqual({ ok: true, username: 'janedoe' });
  });

  // skeleton('___') is '', and '' is a perfectly insertable value for a UNIQUE column: the first
  // such write would claim the empty skeleton and block every later one.
  it('rejects input that folds to an empty skeleton', () => {
    for (const value of ['', '   ', '___', '...', '@', '@@@'])
      expect(validateUsernameFormat(value).ok).toBe(false);
  });

  it('only returns handles the database backstop CHECK also accepts', () => {
    const dbBackstop = /^[a-z][a-z0-9._]{2,29}$/;
    for (const value of ['janedoe', 'jane.doe', 'jane_doe_ng', 'a1b', 'a'.repeat(30)]) {
      const result = validateUsernameFormat(value);
      expect(result.ok).toBe(true);
      if (result.ok) expect(dbBackstop.test(result.username)).toBe(true);
    }
  });

  it('pins the §6.4 change policy', () => {
    expect([USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH]).toEqual([3, 30]);
    expect(CHANGE_COOLDOWN_DAYS).toBe(30);
    expect(LIFETIME_CHANGE_CAP).toBe(3);
    expect(QUARANTINE_DAYS).toBe(90);
    expect(OWNER_RECLAIM_DAYS).toBe(30);
    expect(SUPPORT_APPROVAL_LEVELS).toEqual(['IDENTITY_VERIFIED', 'BUSINESS_VERIFIED', 'ENHANCED']);
  });
});
