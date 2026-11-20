// The shape of config/fees.yaml, which design §6.5 makes the only place a fee or a platform cut is
// set. The YAML uses snake_case because an operator edits it; this module is the single point where
// that becomes camelCase TypeScript, and where a kobo amount stops being a JSON number and becomes
// a bigint. Everything downstream — the calculator, the backend module, the API response — works in
// bigint, so no float can reach a money path.
import { z } from 'zod';
import { currencySchema, type Currency } from '../enums.js';
import type { Kobo } from '../money.js';

/** Who the platform takes its cut from: `seller_commission` or `merchant_commission`. */
export const SELLER_KINDS = ['CASUAL', 'MERCHANT'] as const;
export const sellerKindSchema = z.enum(SELLER_KINDS);
export type SellerKind = z.infer<typeof sellerKindSchema>;

export const BPS_MAX = 10_000;

/** `2026-10-05.1`: the day the value changed, then a counter for a second change on the same day. */
const VERSION = /^\d{4}-\d{2}-\d{2}\.\d+$/;

// `z.int()` rejects a non-integer and anything outside the safe-integer range, so `BigInt()` below
// can never silently truncate. Amounts are non-negative: a negative fee is a payment, not a fee.
const rateBps = z.int().min(0).max(BPS_MAX);
const amount = z
  .int()
  .min(0)
  .transform((value) => BigInt(value));

/** A rate with an optional floor and ceiling; `max_minor: null` means no cap. */
const band = z
  .strictObject({ rate_bps: rateBps, min_minor: amount, max_minor: amount.nullable() })
  .refine((value) => value.max_minor === null || value.min_minor <= value.max_minor, {
    error: 'must not be below min_minor',
    path: ['max_minor'],
  });

const feeFileSchema = z.strictObject({
  version: z.string().regex(VERSION, 'must look like 2026-10-05.1'),
  currency: currencySchema,
  buyer_protection_fee: z
    .strictObject({
      rate_bps: rateBps,
      min_minor: amount,
      max_minor: amount.nullable(),
      refundable_on_full_refund: z.boolean(),
    })
    .refine((value) => value.max_minor === null || value.min_minor <= value.max_minor, {
      error: 'must not be below min_minor',
      path: ['max_minor'],
    }),
  seller_commission: band,
  merchant_commission: band,
  park_cash_handling_fee: z
    .strictObject({ min_minor: amount, max_minor: amount })
    .refine((value) => value.min_minor <= value.max_minor, {
      error: 'must not be below min_minor',
      path: ['max_minor'],
    }),
  payout_fee: z.strictObject({ amount_minor: amount }),
  // Not a fee: how much an account without merchant status may sell (owner ruling 2026-11-20). It
  // lives here because it is a money rule and this file is where money rules are set and versioned.
  casual_sell_limit: z
    .strictObject({ per_trade_minor: amount, per_day_minor: amount })
    .refine((value) => value.per_trade_minor <= value.per_day_minor, {
      error: 'must not be above per_day_minor',
      path: ['per_trade_minor'],
    }),
});

// `readonly` throughout, and frozen at parse time. The whole premise of this ticket is that
// config/fees.yaml is the only place a fee is set; a process-global mutable singleton would be a
// second place, reachable from any module and invisible to both the fee guard and the version check.
export interface FeeBand {
  readonly rateBps: number;
  readonly minMinor: Kobo;
  readonly maxMinor: Kobo | null;
}

export interface FeeSchedule {
  readonly version: string;
  readonly currency: Currency;
  readonly buyerProtectionFee: FeeBand & { readonly refundableOnFullRefund: boolean };
  readonly sellerCommission: FeeBand;
  readonly merchantCommission: FeeBand;
  /** Informational only (C23): the buyer pays a Park agent this in cash; Komtru never touches it. */
  readonly parkCashHandlingFee: { readonly minMinor: Kobo; readonly maxMinor: Kobo };
  readonly payoutFee: { readonly amountMinor: Kobo };
  /**
   * The most an account WITHOUT an active merchant capability may sell: per trade, and in total per
   * Lagos calendar day. Merchants have no selling limit and buying is never limited.
   */
  readonly casualSellLimit: { readonly perTradeMinor: Kobo; readonly perDayMinor: Kobo };
}

/** Freezes the schedule and every band in it, so `readonly` holds at runtime and not only in types. */
export function deepFreezeSchedule<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreezeSchedule(child);
    Object.freeze(value);
  }
  return value;
}

/** Thrown when config/fees.yaml does not match this schema. Names the keys, never the values. */
export class FeeScheduleError extends Error {
  override readonly name = 'FeeScheduleError';
}

type FileBand = z.output<typeof band>;
const toBand = (value: FileBand): FeeBand => ({
  rateBps: value.rate_bps,
  minMinor: value.min_minor,
  maxMinor: value.max_minor,
});

export const feeScheduleSchema: z.ZodType<FeeSchedule, unknown> = feeFileSchema.transform((file) => ({
  version: file.version,
  currency: file.currency,
  buyerProtectionFee: {
    ...toBand(file.buyer_protection_fee),
    refundableOnFullRefund: file.buyer_protection_fee.refundable_on_full_refund,
  },
  sellerCommission: toBand(file.seller_commission),
  merchantCommission: toBand(file.merchant_commission),
  parkCashHandlingFee: {
    minMinor: file.park_cash_handling_fee.min_minor,
    maxMinor: file.park_cash_handling_fee.max_minor,
  },
  payoutFee: { amountMinor: file.payout_fee.amount_minor },
  casualSellLimit: {
    perTradeMinor: file.casual_sell_limit.per_trade_minor,
    perDayMinor: file.casual_sell_limit.per_day_minor,
  },
}));

/**
 * Validates an already-parsed fee file. The error names every bad key at once, so a broken file is
 * fixed in one pass rather than one boot at a time — and it never echoes a value, the same rule
 * src/config/env.ts follows for environment variables.
 */
export function parseFeeSchedule(value: unknown, source = 'the fee schedule'): FeeSchedule {
  const result = feeScheduleSchema.safeParse(value);
  // Frozen before anyone can hold a reference: the schedule is read once at boot and shared by every
  // module, so a single stray assignment would reprice the whole process until it restarts.
  if (result.success) return deepFreezeSchedule(result.data);
  const problems = result.error.issues.map(
    (issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`,
  );
  throw new FeeScheduleError(`${source} is invalid: ${problems.join('; ')}`);
}
