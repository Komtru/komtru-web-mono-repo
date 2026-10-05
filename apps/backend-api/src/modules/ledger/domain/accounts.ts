// M8 §4's chart of accounts, plus BUYER_PROTECTION_FEE_REVENUE (T-070).
//
// An account is a type, a currency and at most one scope, and that triple is its whole identity.
// `accountKey` is the canonical name for it, and it must stay byte-for-byte identical to the
// `account_key` column Postgres generates from the row (schema/accounts.ts) — that is what stops two
// codepaths inventing different accounts for the same money. A discriminated union makes the wrong
// shape unrepresentable in TypeScript; the CHECK makes it unrepresentable in the database.
import { uuidSchema } from '@komtru/shared-types';
import { z } from 'zod';

export const LEDGER_ACCOUNT_TYPES = [
  'PLATFORM_ESCROW_POOL',
  'USER_ESCROW_LIABILITY',
  'USER_PAYABLE',
  'PLATFORM_FEE_REVENUE',
  'BUYER_PROTECTION_FEE_REVENUE',
  'SETTLEMENT_CLEARING',
] as const;

export type LedgerAccountType = (typeof LEDGER_ACCOUNT_TYPES)[number];

export const ENTRY_DIRECTIONS = ['DEBIT', 'CREDIT'] as const;
export type EntryDirection = (typeof ENTRY_DIRECTIONS)[number];

export const PAYMENT_PROVIDERS = ['PAYSTACK', 'FLUTTERWAVE'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

/** V1 is naira only; the column and the key carry the currency so a second one is additive. */
export const DEFAULT_CURRENCY = 'NGN';
export const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'Currency is a three-letter ISO code');

/** The platform-level accounts: one of each per currency, no scope. */
export const PLATFORM_ACCOUNT_TYPES = [
  'PLATFORM_ESCROW_POOL',
  'PLATFORM_FEE_REVENUE',
  'BUYER_PROTECTION_FEE_REVENUE',
] as const;

export type AccountRef =
  | { type: (typeof PLATFORM_ACCOUNT_TYPES)[number] }
  | { type: 'USER_ESCROW_LIABILITY'; tradeId: string }
  | { type: 'USER_PAYABLE'; ownerUserId: string }
  | { type: 'SETTLEMENT_CLEARING'; payoutId: string };

export const accountRefSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('PLATFORM_ESCROW_POOL') }),
  z.strictObject({ type: z.literal('PLATFORM_FEE_REVENUE') }),
  z.strictObject({ type: z.literal('BUYER_PROTECTION_FEE_REVENUE') }),
  z.strictObject({ type: z.literal('USER_ESCROW_LIABILITY'), tradeId: uuidSchema }),
  z.strictObject({ type: z.literal('USER_PAYABLE'), ownerUserId: uuidSchema }),
  z.strictObject({ type: z.literal('SETTLEMENT_CLEARING'), payoutId: uuidSchema }),
]) satisfies z.ZodType<AccountRef, unknown>;

/** The scope a ref carries, or `-` for a platform account; the database spells it the same way. */
export const accountScopeId = (ref: AccountRef): string => {
  switch (ref.type) {
    case 'USER_ESCROW_LIABILITY':
      return ref.tradeId;
    case 'USER_PAYABLE':
      return ref.ownerUserId;
    case 'SETTLEMENT_CLEARING':
      return ref.payoutId;
    default:
      return '-';
  }
};

/** `NGN:USER_PAYABLE:<uuid>`. Identical to the generated `ledger_accounts.account_key`. */
export const accountKey = (ref: AccountRef, currency: string = DEFAULT_CURRENCY): string =>
  `${currency}:${ref.type}:${accountScopeId(ref)}`;

const CREDIT_BALANCE: ReadonlySet<LedgerAccountType> = new Set<LedgerAccountType>([
  'USER_ESCROW_LIABILITY',
  'USER_PAYABLE',
  'PLATFORM_FEE_REVENUE',
  'BUYER_PROTECTION_FEE_REVENUE',
]);

/**
 * Which way an account's balance runs: assets grow on the debit side, liabilities and revenue on
 * the credit side. A balance read in the wrong direction is a number with the right magnitude and
 * the wrong meaning, which is worse than no number, so this is the one definition of it.
 */
export const normalBalance = (type: LedgerAccountType): EntryDirection =>
  CREDIT_BALANCE.has(type) ? 'CREDIT' : 'DEBIT';

/** An amount as it moves the account's own balance: positive when it grows it. */
export const signedMinor = (
  type: LedgerAccountType,
  direction: EntryDirection,
  amountMinor: bigint,
): bigint => (direction === normalBalance(type) ? amountMinor : -amountMinor);
