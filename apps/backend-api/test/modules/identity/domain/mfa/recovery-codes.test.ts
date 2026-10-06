// Screen TF2: ten codes, shown once, each good for one use.
import { describe, expect, it } from 'vitest';
import { createHmacHasher } from '../../../../../src/platform/crypto/hmac.js';
import {
  RECOVERY_CODE_COUNT,
  buildRecoveryBlob,
  generateRecoveryCodes,
  normaliseRecoveryCode,
  parseRecoveryBlob,
  remainingRecoveryCodes,
  spendRecoveryCode,
} from '../../../../../src/modules/identity/domain/mfa/recovery-codes.js';

const hasher = createHmacHasher('pepper-for-tests-0123456789abcdef');

describe('generateRecoveryCodes', () => {
  it('draws ten distinct codes in the shape screen TF2 prints', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) expect(code).toMatch(/^[0-9A-HJ-NP-Z]{4}-[0-9A-HJ-NP-Z]{4}$/);
  });

  /** A code is read off a screen and typed back months later; I/O against 1/0 is a support ticket. */
  it('never draws a character that reads as another one', () => {
    const codes = Array.from({ length: 200 }, () => generateRecoveryCodes()).flat();
    expect(codes.join('')).not.toMatch(/[IO]/);
  });
});

describe('normaliseRecoveryCode', () => {
  it('accepts the code however the user types it back', () => {
    for (const typed of [' 7k2m 9pqx ', '7k2m9pqx', '7K2M-9PQX', '7k2m_9pqx']) {
      expect(normaliseRecoveryCode(typed)).toBe('7K2M-9PQX');
    }
  });

  it('leaves a length it cannot re-hyphenate alone, so it simply fails to match', () => {
    expect(normaliseRecoveryCode('abc')).toBe('ABC');
  });
});

describe('spendRecoveryCode', () => {
  const codes = generateRecoveryCodes();
  const first = codes[0] as string;

  it('spends a code once and never again', () => {
    const blob = buildRecoveryBlob(hasher, codes);
    expect(remainingRecoveryCodes(blob)).toBe(RECOVERY_CODE_COUNT);

    const spent = spendRecoveryCode(hasher, blob, first, 1_700_000_000_000);
    expect(spent).not.toBeNull();
    expect(remainingRecoveryCodes(spent as NonNullable<typeof spent>)).toBe(RECOVERY_CODE_COUNT - 1);
    expect(
      spendRecoveryCode(hasher, spent as NonNullable<typeof spent>, first, 1_700_000_000_000),
    ).toBeNull();
  });

  it('accepts a code typed without its hyphen', () => {
    const blob = buildRecoveryBlob(hasher, codes);
    expect(spendRecoveryCode(hasher, blob, first.replace('-', '').toLowerCase(), 1)).not.toBeNull();
  });

  /** The caller writes the returned blob back; mutating the argument would spend a code on a failure. */
  it('never mutates the blob it was given', () => {
    const blob = buildRecoveryBlob(hasher, codes);
    const before = structuredClone(blob);
    spendRecoveryCode(hasher, blob, first, 1);
    spendRecoveryCode(hasher, blob, 'ZZZZ-ZZZZ', 1);
    expect(blob).toEqual(before);
  });

  it('answers null for a code that was never issued', () => {
    expect(spendRecoveryCode(hasher, buildRecoveryBlob(hasher, codes), 'ZZZZ-ZZZZ', 1)).toBeNull();
  });

  /** The blob holds HMACs, so a decrypted column is still not a list of codes. */
  it('stores no code in clear', () => {
    const blob = buildRecoveryBlob(hasher, codes);
    expect(JSON.stringify(blob)).not.toContain(first);
    expect(JSON.stringify(blob)).not.toContain(first.replace('-', ''));
  });
});

describe('parseRecoveryBlob', () => {
  it('round-trips what buildRecoveryBlob produced', () => {
    const blob = buildRecoveryBlob(hasher, generateRecoveryCodes());
    expect(parseRecoveryBlob(JSON.stringify(blob))).toEqual(blob);
  });

  it('answers null for anything else, so a corrupt column is a clean failure and not a crash', () => {
    for (const payload of ['', 'not json', '{}', '[]', '{"v":2,"codes":[]}', '{"v":1}']) {
      expect(parseRecoveryBlob(payload)).toBeNull();
    }
  });
});
