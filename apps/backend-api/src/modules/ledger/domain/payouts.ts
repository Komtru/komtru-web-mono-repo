// Paying a seller out (T-073), as pure rules: the four journals a payout can post, what the
// provider's transfer status means, the payout's amounts, and the sweep calendar.
//
// The journals (M8 §4 steps 3 and 4, with the fee line T-073 adds and the reversals it needs):
//
//   initiated  DEBIT  USER_PAYABLE(user)          amount
//              CREDIT SETTLEMENT_CLEARING(payout)  amount − fee
//              CREDIT PLATFORM_FEE_REVENUE         fee            (omitted when zero)
//   settled    DEBIT  SETTLEMENT_CLEARING(payout)  amount − fee
//              CREDIT PLATFORM_ESCROW_POOL         amount − fee
//   reversed   DEBIT  SETTLEMENT_CLEARING(payout)  amount − fee   (failed, or reversed before success)
//              DEBIT  PLATFORM_FEE_REVENUE         fee
//              CREDIT USER_PAYABLE(user)           amount
//   returned   DEBIT  PLATFORM_ESCROW_POOL         amount − fee   (the bank sent back a paid transfer)
//              DEBIT  PLATFORM_FEE_REVENUE         fee
//              CREDIT USER_PAYABLE(user)           amount
//
// SETTLEMENT_CLEARING is credit-normal (T-070): between initiation and the bank's answer the money is
// still in our provider balance and still owed to the seller. The cash leaves PLATFORM_ESCROW_POOL
// only on the provider's success. Whatever the outcome, the payout's clearing account ends at zero.
//
// No fee is computed here. The fee arrives already frozen on the payout row from the fee file
// (design §6.5, `snapshotPayoutFee` in the config module); this file only places it.
import { uuidSchema, type Kobo } from '@komtru/shared-types';
import { normaliseAccountRef, type AccountRef } from './accounts.js';
import type { JournalLineInput } from './journal.js';

const PAYOUT_REFERENCE = /^payout-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * OUR reference for one payout: what the provider echoes back on the transfer and its webhooks, and
 * what transfer verify addresses. Paystack accepts lower-case alphanumerics, `-` and `_` here.
 */
export const payoutReference = (payoutId: string): string =>
  `payout-${uuidSchema.parse(payoutId).toLowerCase()}`;

export const isPayoutReference = (reference: string): boolean => PAYOUT_REFERENCE.test(reference);

export const payoutIdFromReference = (reference: string): string | null =>
  isPayoutReference(reference) ? reference.slice('payout-'.length) : null;

export type PayoutJournalStage = 'initiated' | 'settled' | 'reversed' | 'returned';

/** `payout:<id>:<stage>`: each stage posts once, however many times its webhook is delivered. */
export const payoutIdempotencyKey = (payoutId: string, stage: PayoutJournalStage): string =>
  `payout:${uuidSchema.parse(payoutId).toLowerCase()}:${stage}`;

export interface PayoutAmounts {
  /** What leaves the payable. */
  amountMinor: Kobo;
  /** The frozen `payout_fee`. */
  feeMinor: Kobo;
  /** What the bank is sent. */
  transferAmountMinor: Kobo;
}

export class PayoutAmountError extends Error {
  readonly code = 'PAYOUT_AMOUNT_INVALID';
  constructor(
    readonly amountMinor: Kobo,
    readonly feeMinor: Kobo,
  ) {
    super(`a payout of ${amountMinor} with a fee of ${feeMinor} sends nothing`);
    this.name = 'PayoutAmountError';
  }
}

/** The payout's three amounts. Throws when there would be nothing, or less than nothing, to send. */
export function payoutAmounts(amountMinor: Kobo, feeMinor: Kobo): PayoutAmounts {
  if (feeMinor < 0n || amountMinor <= feeMinor) throw new PayoutAmountError(amountMinor, feeMinor);
  return { amountMinor, feeMinor, transferAmountMinor: amountMinor - feeMinor };
}

export interface PayoutParties {
  userId: string;
  payoutId: string;
}

const PLATFORM_ESCROW_POOL: AccountRef = { type: 'PLATFORM_ESCROW_POOL' };
const PLATFORM_FEE_REVENUE: AccountRef = { type: 'PLATFORM_FEE_REVENUE' };
const payable = (p: PayoutParties): AccountRef => ({ type: 'USER_PAYABLE', ownerUserId: p.userId });
const clearing = (p: PayoutParties): AccountRef => ({ type: 'SETTLEMENT_CLEARING', payoutId: p.payoutId });

/** A strictly positive line, or none: a zero fee has no line, and a negative one is a defect. */
const line = (account: AccountRef, direction: 'DEBIT' | 'CREDIT', amountMinor: Kobo): JournalLineInput[] => {
  if (amountMinor < 0n) throw new PayoutAmountError(amountMinor, 0n);
  return amountMinor > 0n ? [{ account: normaliseAccountRef(account), direction, amountMinor }] : [];
};

export const initiatedPayoutLines = (p: PayoutParties, a: PayoutAmounts): JournalLineInput[] => [
  ...line(payable(p), 'DEBIT', a.amountMinor),
  ...line(clearing(p), 'CREDIT', a.transferAmountMinor),
  ...line(PLATFORM_FEE_REVENUE, 'CREDIT', a.feeMinor),
];

export const settledPayoutLines = (p: PayoutParties, a: PayoutAmounts): JournalLineInput[] => [
  ...line(clearing(p), 'DEBIT', a.transferAmountMinor),
  ...line(PLATFORM_ESCROW_POOL, 'CREDIT', a.transferAmountMinor),
];

export const reversedPayoutLines = (p: PayoutParties, a: PayoutAmounts): JournalLineInput[] => [
  ...line(clearing(p), 'DEBIT', a.transferAmountMinor),
  ...line(PLATFORM_FEE_REVENUE, 'DEBIT', a.feeMinor),
  ...line(payable(p), 'CREDIT', a.amountMinor),
];

export const returnedPayoutLines = (p: PayoutParties, a: PayoutAmounts): JournalLineInput[] => [
  ...line(PLATFORM_ESCROW_POOL, 'DEBIT', a.transferAmountMinor),
  ...line(PLATFORM_FEE_REVENUE, 'DEBIT', a.feeMinor),
  ...line(payable(p), 'CREDIT', a.amountMinor),
];

export type TransferOutcome = 'SUCCEEDED' | 'FAILED' | 'REVERSED' | 'PENDING';

const FAILED_STATUSES = new Set(['failed', 'abandoned', 'rejected']);

/**
 * What a provider's transfer status means for the payout. Only the statuses that are final are read
 * as final; everything else — 'pending', 'otp', 'received', 'blocked', and any status nobody has seen
 * before — is still in flight. Guessing success pays a seller money that never left; guessing failure
 * hands back a balance the bank already paid out, and the seller withdraws it twice.
 */
export function transferOutcome(providerStatus: string): TransferOutcome {
  const status = providerStatus.toLowerCase();
  if (status === 'success') return 'SUCCEEDED';
  if (status === 'reversed') return 'REVERSED';
  if (FAILED_STATUSES.has(status)) return 'FAILED';
  return 'PENDING';
}

export const SWEEP_MODES = ['AUTO_DAILY', 'AUTO_WEEKLY', 'AUTO_MONTHLY'] as const;
export type SweepMode = (typeof SWEEP_MODES)[number];

/** Monday, the m8 plan's designated weekly sweep day (ISO weekday 1). */
export const WEEKLY_SWEEP_WEEKDAY = 1;
/** The 1st of the month. */
export const MONTHLY_SWEEP_DAY = 1;

const LAGOS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Lagos',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
});
const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** The calendar date in Africa/Lagos, which is where the schedule runs (T-023). */
export function lagosDate(at: Date): { isoDate: string; weekday: number; day: number } {
  const parts = Object.fromEntries(LAGOS.formatToParts(at).map((p) => [p.type, p.value]));
  return {
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS[parts.weekday ?? ''] ?? 0,
    day: Number(parts.day),
  };
}

/** Which modes a sweep run on this instant pays out (m8 §7). */
export function sweepModesDue(at: Date): SweepMode[] {
  const { weekday, day } = lagosDate(at);
  return [
    'AUTO_DAILY',
    ...(weekday === WEEKLY_SWEEP_WEEKDAY ? (['AUTO_WEEKLY'] as const) : []),
    ...(day === MONTHLY_SWEEP_DAY ? (['AUTO_MONTHLY'] as const) : []),
  ];
}

/** `<mode>:<user>:<lagos date>`: unique on the payout, so a re-run of the same day pays nothing. */
export const sweepKey = (mode: SweepMode, userId: string, at: Date): string =>
  `${mode}:${uuidSchema.parse(userId).toLowerCase()}:${lagosDate(at).isoDate}`;
