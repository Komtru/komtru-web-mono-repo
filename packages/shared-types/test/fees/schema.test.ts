import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { FeeScheduleError, parseFeeSchedule } from '../../src/fees/schema.js';

const valid = {
  version: '2026-10-05.1',
  currency: 'NGN',
  buyer_protection_fee: { rate_bps: 150, min_minor: 0, max_minor: null, refundable_on_full_refund: true },
  seller_commission: { rate_bps: 0, min_minor: 0, max_minor: null },
  merchant_commission: { rate_bps: 0, min_minor: 0, max_minor: null },
  park_cash_handling_fee: { min_minor: 30000, max_minor: 50000 },
  payout_fee: { amount_minor: 0 },
};

/** Returns the thrown error rather than asserting on a callback, so the message can be inspected. */
const thrownBy = (value: unknown, source?: string): Error => {
  try {
    parseFeeSchedule(value, source);
  } catch (error) {
    return error as Error;
  }
  throw new Error('parseFeeSchedule accepted a schedule it should have rejected');
};

describe('parseFeeSchedule', () => {
  it('turns the file into integer kobo and camelCase fields', () => {
    const schedule = parseFeeSchedule(valid);
    expect(schedule.buyerProtectionFee).toEqual({
      rateBps: 150,
      minMinor: 0n,
      maxMinor: null,
      refundableOnFullRefund: true,
    });
    expect(schedule.sellerCommission).toEqual({ rateBps: 0, minMinor: 0n, maxMinor: null });
    expect(schedule.merchantCommission).toEqual({ rateBps: 0, minMinor: 0n, maxMinor: null });
    expect(schedule.parkCashHandlingFee).toEqual({ minMinor: 30000n, maxMinor: 50000n });
    expect(schedule.payoutFee.amountMinor).toBe(0n);
    expect(schedule.version).toBe('2026-10-05.1');
    expect(schedule.currency).toBe('NGN');
  });

  it.each([
    [
      'buyer_protection_fee.rate_bps',
      { buyer_protection_fee: { ...valid.buyer_protection_fee, rate_bps: 1.5 } },
    ],
    [
      'buyer_protection_fee.rate_bps',
      { buyer_protection_fee: { ...valid.buyer_protection_fee, rate_bps: 10001 } },
    ],
    ['seller_commission.min_minor', { seller_commission: { rate_bps: 0, min_minor: -1, max_minor: null } }],
    ['seller_commission.min_minor', { seller_commission: { rate_bps: 0, min_minor: 1e20, max_minor: null } }],
    [
      'merchant_commission.max_minor',
      { merchant_commission: { rate_bps: 0, min_minor: 500, max_minor: 100 } },
    ],
    ['park_cash_handling_fee.max_minor', { park_cash_handling_fee: { min_minor: 50000, max_minor: 30000 } }],
    ['version', { version: 'yesterday' }],
    ['currency', { currency: 'USD' }],
  ])('names %s as the bad key', (key, patch) => {
    const error = thrownBy({ ...valid, ...patch }, 'config/fees.yaml');
    expect(error).toBeInstanceOf(FeeScheduleError);
    expect(error.message).toContain('config/fees.yaml is invalid');
    expect(error.message).toContain(key);
  });

  it('names an unknown key instead of ignoring it', () => {
    expect(thrownBy({ ...valid, buyer_protection_fees: {} }).message).toContain('buyer_protection_fees');
  });

  it('never puts a configured value in the error message', () => {
    const error = thrownBy({
      ...valid,
      buyer_protection_fee: { ...valid.buyer_protection_fee, rate_bps: 424242 },
    });
    expect(error.message).not.toContain('424242');
  });
});

const text = readFileSync(resolve(import.meta.dirname, '../../../../config/fees.yaml'), 'utf8');
const raw = parse(text) as unknown;

describe('config/fees.yaml', () => {
  it('parses with the design §6.5 values', () => {
    const schedule = parseFeeSchedule(raw, 'config/fees.yaml');
    expect(schedule.version).toBe('2026-10-05.1');
    expect(schedule.currency).toBe('NGN');
    expect(schedule.buyerProtectionFee.rateBps).toBe(150);
    expect(schedule.buyerProtectionFee.minMinor).toBe(0n);
    expect(schedule.buyerProtectionFee.maxMinor).toBeNull();
    expect(schedule.buyerProtectionFee.refundableOnFullRefund).toBe(true);
    expect(schedule.sellerCommission).toEqual({ rateBps: 0, minMinor: 0n, maxMinor: null });
    expect(schedule.merchantCommission).toEqual({ rateBps: 0, minMinor: 0n, maxMinor: null });
    expect(schedule.parkCashHandlingFee).toEqual({ minMinor: 30000n, maxMinor: 50000n });
    expect(schedule.payoutFee.amountMinor).toBe(0n);
  });

  it('keeps version a string and max_minor a real null', () => {
    const object = raw as Record<string, unknown>;
    expect(typeof object.version).toBe('string');
    expect((object.buyer_protection_fee as Record<string, unknown>).max_minor).toBeNull();
  });

  it('points at the runbook, so the next person to change a fee finds it', () => {
    expect(text).toContain('docs/runbooks/fees.md');
  });
});
