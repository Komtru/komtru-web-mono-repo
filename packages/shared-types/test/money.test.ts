import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyBps,
  formatNaira,
  koboSchema,
  koboToJson,
  nairaToKobo,
  positiveKoboSchema,
} from '../src/money.js';

describe('koboSchema', () => {
  it('parses a digit string into bigint kobo', () => {
    expect(koboSchema.parse('45200000')).toBe(45200000n);
    expect(koboSchema.parse('-150000')).toBe(-150000n);
    expect(koboSchema.parse('0')).toBe(0n);
  });

  it.each([45200000, '452000.5', '1e5', '', ' 100', '0x10', '+5'])('rejects %j', (input) => {
    expect(koboSchema.safeParse(input).success).toBe(false);
  });
});

describe('positiveKoboSchema', () => {
  it('accepts amounts above zero only', () => {
    expect(positiveKoboSchema.parse('1')).toBe(1n);
    expect(positiveKoboSchema.safeParse('0').success).toBe(false);
    expect(positiveKoboSchema.safeParse('-1').success).toBe(false);
  });
});

describe('formatNaira', () => {
  it.each([
    [45200000n, '₦452,000.00'],
    [0n, '₦0.00'],
    [5n, '₦0.05'],
    [-150000n, '-₦1,500.00'],
    [98000000n, '₦980,000.00'],
  ])('formats %s kobo as %s', (kobo, text) => {
    expect(formatNaira(kobo)).toBe(text);
  });

  it('drops the kobo part on request', () => {
    expect(formatNaira(45200000n, { showKobo: false })).toBe('₦452,000');
  });
});

describe('nairaToKobo', () => {
  it.each([
    ['452000', 45200000n],
    ['452,000.50', 45200050n],
    ['₦1,500.5', 150050n],
    ['-₦1,500.00', -150000n],
    ['0.05', 5n],
  ])('parses %s', (text, kobo) => {
    expect(nairaToKobo(text)).toBe(kobo);
  });

  it.each(['1.234', 'abc', '', '12a', '1..2', '₦'])('rejects %j', (text) => {
    expect(() => nairaToKobo(text)).toThrow(RangeError);
  });
});

describe('applyBps', () => {
  it('computes the 1.5% buyer protection fee on ₦452,000 as ₦6,780 (HTML V1)', () => {
    expect(applyBps(45200000n, 150n)).toBe(678000n);
  });

  it('rounds half up to the kobo', () => {
    expect(applyBps(1n, 5000n)).toBe(1n);
    expect(applyBps(3n, 5000n)).toBe(2n);
    expect(applyBps(1n, 4999n)).toBe(0n);
  });

  it('rejects negative inputs', () => {
    expect(() => applyBps(-1n, 100n)).toThrow(RangeError);
    expect(() => applyBps(100n, -1n)).toThrow(RangeError);
  });
});

describe('round trips (property)', () => {
  const amounts = fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n });

  it('JSON string ↔ bigint is exact, including beyond Number.MAX_SAFE_INTEGER', () => {
    fc.assert(fc.property(amounts, (k) => koboSchema.parse(koboToJson(k)) === k));
  });

  it('formatNaira ↔ nairaToKobo is exact', () => {
    fc.assert(fc.property(amounts, (k) => nairaToKobo(formatNaira(k)) === k));
  });

  it('applyBps never exceeds the amount for bps ≤ 10000', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 18n }), fc.bigInt({ min: 0n, max: 10000n }), (a, b) => {
        const share = applyBps(a, b);
        return share >= 0n && share <= a;
      }),
    );
  });
});
