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
