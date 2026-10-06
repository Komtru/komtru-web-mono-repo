// D1's three outputs, tested as pure functions: everything this module stores about a NIN or a BVN
// comes out of this file, so a change here is a change to what a breach would expose.
import { describe, expect, it } from 'vitest';
import { createHmacHasher } from '../../../src/platform/crypto/hmac.js';
import {
  identifierHash,
  isValidIdentifier,
  maskIdentifier,
  normaliseIdentifier,
} from '../../../src/modules/trust/domain/identifiers.js';

const hasher = createHmacHasher('k'.repeat(32));

describe('normaliseIdentifier', () => {
  it('strips the separators a user types', () => {
    expect(normaliseIdentifier(' 123-456-789 01 ')).toBe('12345678901');
  });

  it('leaves a clean number alone', () => {
    expect(normaliseIdentifier('12345678901')).toBe('12345678901');
  });
});

describe('isValidIdentifier', () => {
  it('accepts exactly eleven digits', () => {
    expect(isValidIdentifier('NIN', '12345678901')).toBe(true);
    expect(isValidIdentifier('BVN', '12345678901')).toBe(true);
  });

  it('refuses anything shorter, longer or non-numeric', () => {
    expect(isValidIdentifier('NIN', '1234567890')).toBe(false);
    expect(isValidIdentifier('NIN', '123456789012')).toBe(false);
    expect(isValidIdentifier('NIN', '1234567890a')).toBe(false);
    expect(isValidIdentifier('NIN', '')).toBe(false);
  });
});

describe('maskIdentifier', () => {
  it('keeps the last four digits and hides the rest', () => {
    expect(maskIdentifier('12345678901')).toBe('*******8901');
  });

  it('never reveals more than four digits, however short the input', () => {
    expect(maskIdentifier('123')).toBe('***');
  });
});

describe('identifierHash', () => {
  it('separates the NIN and BVN domains, so a leaked row cannot confirm a guess at the other table', () => {
    expect(identifierHash(hasher, 'NIN', '12345678901')).not.toEqual(
      identifierHash(hasher, 'BVN', '12345678901'),
    );
  });

  it('is stable across equivalent spellings of the same number', () => {
    expect(identifierHash(hasher, 'NIN', normaliseIdentifier('123-456-789-01'))).toEqual(
      identifierHash(hasher, 'NIN', '12345678901'),
    );
  });

  it('differs under a different key, so rotating the pepper is a real rotation', () => {
    const other = createHmacHasher('j'.repeat(32));
    expect(identifierHash(hasher, 'NIN', '12345678901')).not.toEqual(
      identifierHash(other, 'NIN', '12345678901'),
    );
  });

  it('refuses a number that has not been normalised, rather than hashing a different string', () => {
    expect(() => identifierHash(hasher, 'NIN', '123-456-789-01')).toThrow(/normalised/i);
  });
});
