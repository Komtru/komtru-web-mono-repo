// The ledger events this module consumes. T-065 (design §6.4): the release has posted, so the
// trade can move `COMPLETED -> SETTLED`. F-024: the funding has posted, so `PENDING_PAYMENT -> FUNDED`.
//
// This is the consumer's declaration, not a second source of truth. The ledger owns the event
// (`paymentEscrowReleasedEvent`, T-074) and already imports this module, so importing it back here
// would be a cycle. The name, version and the fields read below are the contract; zod strips the
// rest. SEAM(T-074): when that ticket is on main, replace this with the ledger's exported definition
// if the module boundary rules allow it, or keep this and let the ledger's event test pin the shape.
import { defineEvent } from '@komtru/shared-types';
import { z } from 'zod';

export const ledgerEscrowReleasedEvent = defineEvent(
  'ledger.payment.escrow_released',
  1,
  z.object({
    tradeId: z.uuid(),
    journalEntryId: z.uuid(),
  }),
);

/**
 * F-024: the ledger has escrowed the buyer's payment, so `PENDING_PAYMENT -> FUNDED`. Declared here for the
 * same reason as the release: the ledger owns `paymentEscrowFundedEvent` (T-072) and imports this module.
 * The amount and currency are read only to check them against the trade's own snapshot before funding.
 */
export const ledgerEscrowFundedEvent = defineEvent(
  'ledger.payment.escrow_funded',
  1,
  z.object({
    tradeId: z.uuid(),
    paymentAttemptId: z.uuid(),
    journalEntryId: z.uuid(),
    reference: z.string().min(1),
    currency: z.string(),
    /** What the buyer paid, digit-string kobo: must equal the trade's snapshotted buyer total. */
    amountMinor: z.string().regex(/^\d{1,19}$/),
  }),
);

export const FUNDING_REVIEW_REASONS = [
  'TRADE_NOT_AWAITING_PAYMENT',
  'UNKNOWN_TRADE',
  'AMOUNT_MISMATCH',
] as const;

/**
 * F-024: the ledger escrowed money that the trade will not take — the trade ended before the event arrived,
 * does not exist, or the amount or currency is not what its snapshot says. The money stays escrowed and is
 * NOT refunded automatically (T-072 decision 8); this is the durable signal ops works from, in the same
 * transaction as the claim on the ledger's event. Published by trades, not the ledger: the ledger's own
 * `ledger.payment.review_required` means "nothing was posted", and here the posting has happened.
 */
export const tradeFundingReviewRequiredEvent = defineEvent(
  'trades.funding.review_required',
  1,
  z.object({
    tradeId: z.uuid(),
    paymentAttemptId: z.uuid(),
    journalEntryId: z.uuid(),
    reference: z.string().min(1),
    reason: z.enum(FUNDING_REVIEW_REASONS),
    /** The trade's status when the money arrived; null for a trade that does not exist. */
    tradeStatus: z.string().nullable(),
    currency: z.string(),
    amountMinor: z.string(),
    /** The trade's snapshotted buyer total; null when there is no trade or no snapshot. */
    expectedAmountMinor: z.string().nullable(),
  }),
);

/**
 * T-066: the ledger has decided a refund and posted it (`paymentEscrowRefundedEvent`, T-075), so a FUNDED
 * trade moves `FUNDED -> CANCELLED_REFUNDED` with `reason` as its cancellation reason. Declared here for the
 * same reason as the two above. A PARTIAL refund is a dispute outcome and moves nothing here.
 */
export const ledgerEscrowRefundedEvent = defineEvent(
  'ledger.payment.escrow_refunded',
  1,
  z.object({
    tradeId: z.uuid(),
    refundId: z.uuid(),
    journalEntryId: z.uuid(),
    reason: z.string().min(1),
    scope: z.enum(['FULL', 'PARTIAL']),
  }),
);
