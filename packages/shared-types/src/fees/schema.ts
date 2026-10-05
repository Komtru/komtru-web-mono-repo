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
});

export interface FeeBand {
  rateBps: number;
  minMinor: Kobo;
  maxMinor: Kobo | null;
}

export interface FeeSchedule {
  version: string;
  currency: Currency;
  buyerProtectionFee: FeeBand & { refundableOnFullRefund: boolean };
  sellerCommission: FeeBand;
  merchantCommission: FeeBand;
  /** Informational only (C23): the buyer pays a Park agent this in cash; Komtru never touches it. */
  parkCashHandlingFee: { minMinor: Kobo; maxMinor: Kobo };
  payoutFee: { amountMinor: Kobo };
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
}));

/**
 * Validates an already-parsed fee file. The error names every bad key at once, so a broken file is
 * fixed in one pass rather than one boot at a time — and it never echoes a value, the same rule
 * src/config/env.ts follows for environment variables.
 */
export function parseFeeSchedule(value: unknown, source = 'the fee schedule'): FeeSchedule {
  const result = feeScheduleSchema.safeParse(value);
  if (result.success) return result.data;
  const problems = result.error.issues.map(
    (issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`,
  );
  throw new FeeScheduleError(`${source} is invalid: ${problems.join('; ')}`);
}
