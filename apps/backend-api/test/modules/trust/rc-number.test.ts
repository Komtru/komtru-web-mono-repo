// The CAC registration number's normal form.
//
// Youverify's own validator refuses a bare number — `Invalid registration number. Valid format =>
// RCxxxx, BNxxxxx, ITxxxxx, LPxxxxx or LLPxxxxx` (captured 2026-11-19, see
// test/fixtures/youverify/company-bare-number-rejected.json) — so the prefix is part of the
// identifier, not noise to strip. It is also what tells one registration from another: before this,
// RC1487322 and BN1487322 hashed to the same §7 duplicate key.
import { describe, expect, it } from 'vitest';
import { createHmacHasher } from '../../../src/platform/crypto/hmac.js';
import {
  isValidRcNumber,
  normaliseRcNumber,
  rcNumberHash,
} from '../../../src/modules/trust/domain/identifiers.js';

const hasher = createHmacHasher('k'.repeat(32));

describe('normaliseRcNumber', () => {
  it('keeps the entity prefix', () => {
    expect(normaliseRcNumber('rc 1487322')).toBe('RC1487322');
    expect(normaliseRcNumber('BN-1487322')).toBe('BN1487322');
    expect(normaliseRcNumber(' llp/1487322 ')).toBe('LLP1487322');
  });

  it('still strips case and separators, which users type inconsistently', () => {
    expect(normaliseRcNumber('rc-148 7322')).toBe(normaliseRcNumber('RC1487322'));
  });

  it('does not collapse different entity types onto one key', () => {
    const codes = ['RC1487322', 'BN1487322', 'IT1487322', 'LP1487322', 'LLP1487322'];
    expect(new Set(codes.map((code) => normaliseRcNumber(code))).size).toBe(5);
  });

  it('leaves a bare number alone rather than inventing a prefix', () => {
    expect(normaliseRcNumber('1487322')).toBe('1487322');
  });
});

describe('isValidRcNumber', () => {
  it('accepts a prefixed number', () => {
    expect(isValidRcNumber('RC1487322')).toBe(true);
    expect(isValidRcNumber('LLP1487322')).toBe(true);
  });

  it('accepts a bare number, because the provider is the authority on existence', () => {
    expect(isValidRcNumber('1487322')).toBe(true);
  });

  it('refuses something too short, too long, or not alphanumeric', () => {
    expect(isValidRcNumber('RC')).toBe(false);
    expect(isValidRcNumber('R'.repeat(21))).toBe(false);
    expect(isValidRcNumber('RC-1487322')).toBe(false);
  });
});

describe('rcNumberHash', () => {
  it('gives two entity types two different duplicate keys', () => {
    expect(rcNumberHash(hasher, normaliseRcNumber('RC1487322'))).not.toEqual(
      rcNumberHash(hasher, normaliseRcNumber('BN1487322')),
    );
  });

  it('refuses a number that has not been normalised', () => {
    expect(() => rcNumberHash(hasher, 'rc 1487322')).toThrow(/normalised/i);
  });
});
