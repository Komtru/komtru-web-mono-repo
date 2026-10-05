// Trade codes are the reference a buyer reads to support over the phone. One format, from
// shared-types; this module issues codes, it does not define a second shape for them.
import { tradeCodeSchema } from '@komtru/shared-types';
import { describe, expect, it } from 'vitest';
import { generateTradeCode } from '../../../../src/modules/trades/domain/tradeCode.js';

describe('generateTradeCode', () => {
  it('issues the KMT-<7 digits>-NG form', () => {
    expect(generateTradeCode()).toMatch(/^KMT-\d{7}-NG$/);
  });

  it('issues codes tradeCodeSchema accepts unchanged', () => {
    const code = generateTradeCode();
    expect(tradeCodeSchema.parse(code)).toBe(code);
  });

  // Non-sequential: a sequential code leaks the platform's trade count and makes the trade next to
  // yours guessable. The price is that random codes do repeat — ~6 times in 10,000 draws from nine
  // million — so uniqueness is the unique index's job plus a retry at the call site, never the
  // generator's. A generator that never repeated would be a sequence, which is the thing avoided.
  it('walks nothing: no run of consecutive codes', () => {
    const digits = Array.from({ length: 10_000 }, () => Number(generateTradeCode().slice(4, 11)));
    const consecutive = digits.filter((value, i) => i > 0 && value === (digits[i - 1] ?? 0) + 1);
    expect(consecutive.length).toBeLessThan(5);
  });

  it('repeats rarely enough for the unique index and one retry to cover it', () => {
    const codes = Array.from({ length: 10_000 }, generateTradeCode);
    expect(codes.length - new Set(codes).size).toBeLessThan(30);
  });
});
