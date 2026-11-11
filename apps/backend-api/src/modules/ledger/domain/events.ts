// The ledger's domain events (design §4.3). Published through the outbox inside the transaction
// that wrote the journal entry, so the posting and the announcement of it either both happen or
// neither does — a consumer that sees this event can rely on the entry being readable.
import { defineEvent, koboSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { ENTRY_DIRECTIONS, LEDGER_ACCOUNT_TYPES, PAYMENT_PROVIDERS } from './accounts.js';

/**
 * Kobo on the wire. The outbox row is jsonb, so a payload that decoded to `bigint` could not be
 * serialised into it at all: an amount stays the digit string `koboSchema` validates, and a
 * consumer that wants arithmetic runs `koboSchema.parse()` on it.
 */
const amountMinorSchema = z
  .string()
  .refine((value) => koboSchema.safeParse(value).success, 'Amount must be a whole number of kobo');

const postedLineSchema = z.object({
  /** `NGN:USER_PAYABLE:<uuid>` — the account's canonical name, stable across environments. */
  accountKey: z.string(),
  accountType: z.enum(LEDGER_ACCOUNT_TYPES),
  direction: z.enum(ENTRY_DIRECTIONS),
  amountMinor: amountMinorSchema,
});

export const ledgerJournalPostedEvent = defineEvent(
  'ledger.journal.posted',
  1,
  z.object({
    journalEntryId: z.uuid(),
    idempotencyKey: z.string(),
    description: z.string(),
    currency: z.string(),
    tradeId: z.uuid().nullish(),
    escrowActionRequestId: z.uuid().nullish(),
    provider: z.enum(PAYMENT_PROVIDERS).nullish(),
    providerReference: z.string().nullish(),
    postedAt: z.iso.datetime(),
    lines: z.array(postedLineSchema).min(2),
  }),
);

/**
 * A trade's escrow is funded (M8 §9, design §6.4): the funding journal has posted, in the same
 * transaction as this event. M7 consumes it to move the trade `PENDING_PAYMENT → FUNDED`; T-056's
 * stock reservation keys on `tradeId` from it. The ledger never transitions a trade itself.
 */
export const paymentEscrowFundedEvent = defineEvent(
  'ledger.payment.escrow_funded',
  1,
  z.object({
    tradeId: z.uuid(),
    paymentAttemptId: z.uuid(),
    journalEntryId: z.uuid(),
    provider: z.enum(PAYMENT_PROVIDERS),
    /** OUR charge reference, `fund-<attempt id>`. */
    reference: z.string().min(1),
    currency: z.string(),
    /** What the buyer paid: the item plus the buyer protection fee. */
    amountMinor: amountMinorSchema,
    itemAmountMinor: amountMinorSchema,
    buyerProtectionFeeMinor: amountMinorSchema,
    fundedAt: z.iso.datetime(),
  }),
);

/**
 * How a settlement divided the escrowed item (T-074). `RELEASED` is the whole item on
 * `trade.completed`; `DISPUTE_SPLIT` is T-080's resolution with amounts, where part goes back to
 * the buyer. One event rather than two, because a consumer that only cares that the trade's escrow
 * is settled should not have to learn both names.
 */
export const ESCROW_RELEASE_OUTCOMES = ['RELEASED', 'DISPUTE_SPLIT'] as const;
export type EscrowReleaseOutcome = (typeof ESCROW_RELEASE_OUTCOMES)[number];

/** What became of the buyer protection fee: earned, or handed back with the refunded item. */
export const FEE_TREATMENTS = ['RECOGNISE', 'REFUND'] as const;

/**
 * A trade's escrow is settled (M8 §9, design §6.4): the release journal has posted, in the same
 * transaction as this event. M7 consumes it to move the trade `COMPLETED → SETTLED`; T-073 pays the
 * seller out of the payable it credited; Reputation keys on the completed trade. The ledger never
 * transitions a trade itself.
 */
export const paymentEscrowReleasedEvent = defineEvent(
  'ledger.payment.escrow_released',
  1,
  z.object({
    tradeId: z.uuid(),
    journalEntryId: z.uuid(),
    sellerUserId: z.uuid(),
    currency: z.string(),
    outcome: z.enum(ESCROW_RELEASE_OUTCOMES),
    /** What left the trade's escrow liability: the item, never the buyer total (T-072). */
    itemAmountMinor: amountMinorSchema,
    /** What was credited to the seller's payable — on a split, the share actually released. */
    sellerProceedsMinor: amountMinorSchema,
    /** The platform's cut of the released share, recognised as revenue in the same journal. */
    commissionMinor: amountMinorSchema,
    /** Zero on a normal release; the share returned to the escrow pool on a split. */
    refundToBuyerMinor: amountMinorSchema,
    buyerProtectionFeeMinor: amountMinorSchema,
    buyerProtectionFeeTreatment: z.enum(FEE_TREATMENTS),
    releasedAt: z.iso.datetime(),
  }),
);

/**
 * A verified charge the ledger would not post: an under- or over-payment, another currency, a
 * reversal, money on a trade no longer awaiting it, or money on an attempt already closed. Nothing
 * was posted; ops decides (T-076 consumes it). Published in the transaction that recorded it.
 */
export const paymentReviewRequiredEvent = defineEvent(
  'ledger.payment.review_required',
  1,
  z.object({
    tradeId: z.uuid(),
    paymentAttemptId: z.uuid(),
    provider: z.enum(PAYMENT_PROVIDERS),
    reference: z.string().min(1),
    reason: z.string().min(1),
    providerStatus: z.string(),
    /** What the provider says was paid, which is not what was due. */
    verifiedAmountMinor: amountMinorSchema.nullable(),
    verifiedCurrency: z.string().nullable(),
    dueAmountMinor: amountMinorSchema,
  }),
);

const PAYOUT_TRIGGER_VALUES = ['MANUAL', 'AUTO_IMMEDIATE', 'AUTO_SWEEP'] as const;

/**
 * A payout was asked for (T-073): the seller's payable was debited into the payout's clearing account
 * in the same transaction. The ledger's own dispatch subscriber consumes it to queue the transfer, so
 * the job never runs before the payout row it reads has committed.
 */
export const payoutRequestedEvent = defineEvent(
  'ledger.payout.requested',
  1,
  z.object({
    payoutId: z.uuid(),
    userId: z.uuid(),
    trigger: z.enum(PAYOUT_TRIGGER_VALUES),
    reference: z.string().min(1),
    currency: z.string(),
    amountMinor: amountMinorSchema,
    feeMinor: amountMinorSchema,
    transferAmountMinor: amountMinorSchema,
    requestedAt: z.iso.datetime(),
  }),
);

export const PAYOUT_OUTCOMES = ['SUCCEEDED', 'FAILED', 'REVERSED', 'NEEDS_REVIEW'] as const;

/**
 * A payout reached an outcome (T-073): the settling or reversing journal posted in the same
 * transaction, or — for NEEDS_REVIEW — nothing posted and ops decides (T-076). WF1 and the seller's
 * notifications key on it. A SUCCEEDED payout the bank later returns publishes again as REVERSED.
 */
export const payoutCompletedEvent = defineEvent(
  'ledger.payout.completed',
  1,
  z.object({
    payoutId: z.uuid(),
    userId: z.uuid(),
    outcome: z.enum(PAYOUT_OUTCOMES),
    reference: z.string().min(1),
    currency: z.string(),
    amountMinor: amountMinorSchema,
    transferAmountMinor: amountMinorSchema,
    /** The journal that answers for the outcome; null for NEEDS_REVIEW. */
    journalEntryId: z.uuid().nullable(),
    reason: z.string().nullable(),
    completedAt: z.iso.datetime(),
  }),
);

export const PAYOUT_SKIP_REASONS = [
  'HELD',
  'NO_VERIFIED_ACCOUNT',
  'INSUFFICIENT_BALANCE',
  'AMOUNT_TOO_SMALL',
] as const;

/**
 * An automatic payout (AUTO_IMMEDIATE or a sweep) that was due and was not made, and why. Nothing
 * moved. Published so the seller can be told their money is waiting (a missing account) and risk can
 * see a hold doing its job.
 */
export const payoutAutoSkippedEvent = defineEvent(
  'ledger.payout.auto_skipped',
  1,
  z.object({
    userId: z.uuid(),
    trigger: z.enum(['AUTO_IMMEDIATE', 'AUTO_SWEEP']),
    reason: z.enum(PAYOUT_SKIP_REASONS),
    /** The sweep key, or the release journal an immediate payout would have paid out. */
    key: z.string().min(1),
    amountMinor: amountMinorSchema,
  }),
);

/** What became of the buyer protection fee on a refund (T-075, design §12 Q4). */
export const REFUND_FEE_TREATMENTS = ['REFUND', 'RECOGNISE', 'RETAIN'] as const;
export const REFUND_SCOPES = ['FULL', 'PARTIAL'] as const;

/**
 * A refund was decided (M8 §9, T-075): the decision journal has posted and the refund row is written,
 * in the same transaction as this event. M7 consumes it to move the trade `FUNDED -> CANCELLED_REFUNDED`
 * with `reason` as the cancellation reason; the ledger's own dispatch subscriber queues the provider
 * call on it. The money is on its way, not yet back: `ledger.refund.completed` says when it is.
 */
export const paymentEscrowRefundedEvent = defineEvent(
  'ledger.payment.escrow_refunded',
  1,
  z.object({
    tradeId: z.uuid(),
    refundId: z.uuid(),
    journalEntryId: z.uuid(),
    buyerUserId: z.uuid(),
    /** `trades.refund.requested`'s reason: DELIVERY_OVERDUE, SELLER_CANNOT_FULFIL, MUTUAL_AGREEMENT. */
    reason: z.string().min(1),
    scope: z.enum(REFUND_SCOPES),
    currency: z.string(),
    /** Out of the trade's escrow liability. */
    itemAmountMinor: amountMinorSchema,
    /** The protection fee handed back with it; zero when retained or recognised. */
    feeAmountMinor: amountMinorSchema,
    /** What the buyer gets back: item plus fee. */
    amountMinor: amountMinorSchema,
    buyerProtectionFeeTreatment: z.enum(REFUND_FEE_TREATMENTS),
    refundedAt: z.iso.datetime(),
  }),
);

export const REFUND_OUTCOMES = ['PROCESSED', 'FAILED', 'NEEDS_REVIEW'] as const;

/**
 * A refund reached an outcome on the provider's own record of it (T-075). PROCESSED: the money is back
 * on the buyer's payment method. FAILED: it came back to our balance and the failure journal has
 * returned it to the trade's liabilities, in this transaction. NEEDS_REVIEW: nothing posted; ops
 * decides (T-076). Notifications and CR3/SC2 key on it.
 */
export const refundCompletedEvent = defineEvent(
  'ledger.refund.completed',
  1,
  z.object({
    refundId: z.uuid(),
    tradeId: z.uuid(),
    buyerUserId: z.uuid(),
    outcome: z.enum(REFUND_OUTCOMES),
    currency: z.string(),
    amountMinor: amountMinorSchema,
    /** The failure journal for FAILED; null otherwise. */
    journalEntryId: z.uuid().nullable(),
    reason: z.string().nullable(),
    completedAt: z.iso.datetime(),
  }),
);
