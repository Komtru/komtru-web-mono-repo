import { describe, expect, it } from 'vitest';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_REJECTION_MESSAGE,
  checkPasswordPolicy,
  type PasswordRejection,
} from '../../../../../src/modules/identity/domain/credential/policy.js';

describe('password policy (S2)', () => {
  it('rejects below ten characters and accepts ten', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(checkPasswordPolicy('nine char').rejection).toBe('TOO_SHORT');
    expect(checkPasswordPolicy('tencharact').ok).toBe(true);
  });

  it('has no composition rules: length and breach-checking beat forced symbols', () => {
    expect(checkPasswordPolicy('correct horse battery staple').ok).toBe(true);
    expect(checkPasswordPolicy('abcdefghijklmnop').ok).toBe(true);
  });

  it('rejects the offline list, which is what a breach-check outage falls back to', () => {
    expect(checkPasswordPolicy('password12').rejection).toBe('COMMON');
    expect(checkPasswordPolicy('Password12').rejection).toBe('COMMON');
    expect(checkPasswordPolicy('  qwerty1234  ').rejection).toBe('COMMON');
  });

  it('refuses a password that contains the identifier it protects', () => {
    expect(checkPasswordPolicy('janedoe2026!', { identifiers: ['janedoe'] }).rejection).toBe(
      'CONTAINS_IDENTIFIER',
    );
    expect(checkPasswordPolicy('jane@example.com', { identifiers: ['jane@example.com'] }).rejection).toBe(
      'CONTAINS_IDENTIFIER',
    );
  });

  it('sees through the punctuation in either the password or the identifier', () => {
    // The stored phone is E.164; nobody types the '+' into a password. Comparing the raw strings
    // meant `2348023415567abc` sailed past `+2348023415567`, which made the check useless for the
    // identifier M1 D4 calls primary in this market.
    expect(checkPasswordPolicy('2348023415567abc', { identifiers: ['+2348023415567'] }).rejection).toBe(
      'CONTAINS_IDENTIFIER',
    );
    expect(checkPasswordPolicy('my 234 802 3415567!', { identifiers: ['+2348023415567'] }).rejection).toBe(
      'CONTAINS_IDENTIFIER',
    );
    expect(checkPasswordPolicy('jane.doe.2026', { identifiers: ['janedoe'] }).rejection).toBe(
      'CONTAINS_IDENTIFIER',
    );
  });

  it('still accepts a password that merely shares a few characters with an identifier', () => {
    expect(checkPasswordPolicy('correct horse battery staple', { identifiers: ['+2348023415567'] }).ok).toBe(
      true,
    );
    expect(checkPasswordPolicy('a quiet afternoon', { identifiers: ['jane@example.com'] }).ok).toBe(true);
  });

  it('ignores an identifier too short to be a meaningful substring', () => {
    // '+234' is in half the phone numbers in the country; refusing every password containing it
    // would reject passwords for no reason.
    expect(checkPasswordPolicy('a234bcdefgh', { identifiers: ['234'] }).ok).toBe(true);
  });

  it('bounds the input, because argon2 hashes whatever it is given', () => {
    expect(checkPasswordPolicy('a'.repeat(MAX_PASSWORD_LENGTH)).ok).toBe(true);
    expect(checkPasswordPolicy('a'.repeat(MAX_PASSWORD_LENGTH + 1)).rejection).toBe('TOO_LONG');
  });

  it('has a message for every rejection', () => {
    const all: PasswordRejection[] = [
      'TOO_SHORT',
      'TOO_LONG',
      'COMMON',
      'CONTAINS_IDENTIFIER',
      'BREACHED',
      'REUSED',
    ];
    for (const rejection of all) expect(PASSWORD_REJECTION_MESSAGE[rejection]).toBeTruthy();
  });

  it('never names the rule that failed in a way that helps a guesser', () => {
    // The messages are advice to the owner of the account, not a description of the corpus.
    expect(PASSWORD_REJECTION_MESSAGE.BREACHED).not.toMatch(/haveibeenpwned|hibp/i);
  });
});
