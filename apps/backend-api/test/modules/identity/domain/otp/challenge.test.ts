import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  OTP_CODE_DIGITS,
  OTP_MAX_ATTEMPTS,
  OTP_SEND_BURST,
  OTP_SEND_DAILY,
  OTP_TTL_SECONDS,
  PROOF_TOKEN_TTL_SECONDS,
  hashCode,
  hashDestination,
  matchesCode,
  otpExpiry,
  otpPurposeLabel,
  splitProofToken,
} from '../../../../../src/modules/identity/domain/otp/challenge.js';
import { createHmacHasher } from '../../../../../src/platform/crypto/hmac.js';

const h = createHmacHasher('pepper-for-tests-0123456789abcdef');

describe('OTP challenge arithmetic (S4, S6)', () => {
  it('pins the numbers M1 names', () => {
    expect(OTP_CODE_DIGITS).toBe(6);
    expect(OTP_TTL_SECONDS).toBe(300);
    expect(OTP_MAX_ATTEMPTS).toBe(5);
    expect(OTP_SEND_BURST).toEqual({ max: 3, windowSeconds: 600 });
    expect(OTP_SEND_DAILY).toEqual({ max: 10, windowSeconds: 86_400 });
  });

  it('expires five minutes after it was issued', () => {
    expect(otpExpiry(new Date('2026-10-06T10:00:00Z'))).toEqual(new Date('2026-10-06T10:05:00Z'));
  });

  it('binds a code hash to its purpose and destination, so one row never confirms another', () => {
    const dest = hashDestination(h, '+2348012345678');
    const other = hashDestination(h, '+2348012345679');
    const a = hashCode(h, { purpose: 'REGISTRATION', destinationHash: dest, code: '482913' });

    expect(hashCode(h, { purpose: 'PASSWORD_RESET', destinationHash: dest, code: '482913' }).equals(a)).toBe(
      false,
    );
    expect(hashCode(h, { purpose: 'REGISTRATION', destinationHash: other, code: '482913' }).equals(a)).toBe(
      false,
    );
    expect(hashCode(h, { purpose: 'REGISTRATION', destinationHash: dest, code: '482913' }).equals(a)).toBe(
      true,
    );
  });

  it('hashes the destination under a different domain from the code', () => {
    // Without the domain split, the HMAC of '482913' as a destination and as a code are the same
    // value, so a leaked row from one column confirms a guess against the other.
    const asDestination = hashDestination(h, '482913');
    const asCode = hashCode(h, {
      purpose: 'REGISTRATION',
      destinationHash: Buffer.alloc(32),
      code: '482913',
    });
    expect(asDestination.equals(asCode)).toBe(false);
  });

  it('normalises nothing: the caller is responsible for the canonical destination', () => {
    // normaliseEmail / normalisePhone run at the service boundary. Two spellings of one address
    // hashing differently here is the correct behaviour, and the reason the rule lives upstream.
    expect(hashDestination(h, 'Jane@Example.com').equals(hashDestination(h, 'jane@example.com'))).toBe(false);
  });

  it('matches a code in constant time and rejects a wrong one', () => {
    const dest = hashDestination(h, '+2348012345678');
    const stored = hashCode(h, { purpose: 'LOGIN', destinationHash: dest, code: '000042' });
    expect(matchesCode(h, { purpose: 'LOGIN', destinationHash: dest, code: '000042' }, stored)).toBe(true);
    expect(matchesCode(h, { purpose: 'LOGIN', destinationHash: dest, code: '42' }, stored)).toBe(false);
    expect(matchesCode(h, { purpose: 'LOGIN', destinationHash: dest, code: '000043' }, stored)).toBe(false);
  });

  it('splits a proof token into its challenge id and secret, and rejects anything else', () => {
    const id = randomUUID();
    expect(splitProofToken(`${id}.abcdef`)).toEqual({ challengeId: id, secret: 'abcdef' });
    expect(splitProofToken('no-dot')).toBeNull();
    expect(splitProofToken('not-a-uuid.secret')).toBeNull();
    expect(splitProofToken(`${id}.`)).toBeNull();
    expect(splitProofToken(`.${id}`)).toBeNull();
    expect(splitProofToken('')).toBeNull();
  });

  it('keeps a secret containing a dot intact', () => {
    const id = randomUUID();
    expect(splitProofToken(`${id}.a.b.c`)).toEqual({ challengeId: id, secret: 'a.b.c' });
  });

  it('gives a proof token a longer life than a six-digit code, and still a short one', () => {
    expect(PROOF_TOKEN_TTL_SECONDS).toBeGreaterThan(OTP_TTL_SECONDS);
    expect(PROOF_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(3600);
  });

  it('gives every purpose human copy for the SMS body', () => {
    // The seeded template is 'Komtru: {{code}} is your {{purpose}} code.'
    expect(otpPurposeLabel('REGISTRATION')).toBe('verification');
    expect(otpPurposeLabel('PASSWORD_RESET')).toBe('password reset');
    expect(otpPurposeLabel('LOGIN')).toBe('sign-in');
    for (const purpose of [
      'REGISTRATION',
      'LOGIN',
      'PHONE_VERIFICATION',
      'EMAIL_VERIFICATION',
      'PASSWORD_RESET',
      'MFA_CHALLENGE',
      'SENSITIVE_ACTION',
      'ACCOUNT_RECOVERY',
    ] as const) {
      expect(otpPurposeLabel(purpose)).toMatch(/^[a-z][a-z -]*$/);
    }
  });
});
