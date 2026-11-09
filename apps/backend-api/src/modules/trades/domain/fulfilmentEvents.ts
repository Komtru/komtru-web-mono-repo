// What fulfilment publishes (T-064), through the transactional outbox in the transaction that made
// it true. `trades.refund.requested` is the seam T-075 consumes: a trade never refunds anything, it
// asks (design §6.4, M7 §0 rule 2), and it asks with no amount, because the amount is a money rule
// the refund ticket derives from the trade's fee snapshot.
import { defineEvent, tradeCodeSchema, uuidSchema } from '@komtru/shared-types';
import { z } from 'zod';

const EXTENSION_REASONS = [
  'COURIER_PICKUP_DELAYED',
  'RESTOCKING_ITEM',
  'ADDRESS_OR_LOGISTICS_ISSUE',
] as const;
export const DELIVERY_EXTENSION_REASONS = EXTENSION_REASONS;

/** DE1: the seller asked for more time. T-068 turns this into the buyer's notification (DE2). */
export const tradeDeliveryExtensionRequestedEvent = defineEvent(
  'trades.delivery_extension.requested',
  1,
  z.object({
    tradeId: uuidSchema,
    tradeCode: tradeCodeSchema,
    requestId: uuidSchema,
    deadlineId: uuidSchema,
    requestedByUserId: uuidSchema,
    reason: z.enum(EXTENSION_REASONS),
    currentDueAt: z.iso.datetime(),
    requestedDueAt: z.iso.datetime(),
  }),
);

/** DE2: the buyer answered. `newDueAt` is present only when the answer moved the deadline. */
export const tradeDeliveryExtensionRespondedEvent = defineEvent(
  'trades.delivery_extension.responded',
  1,
  z.object({
    tradeId: uuidSchema,
    tradeCode: tradeCodeSchema,
    requestId: uuidSchema,
    decision: z.enum(['ACCEPTED', 'DECLINED']),
    respondedByUserId: uuidSchema,
    newDueAt: z.iso.datetime().optional(),
  }),
);

/** DE3: the delivery deadline passed. Always published; `refundRequested` says whether a refund follows. */
export const tradeDeliveryOverdueEvent = defineEvent(
  'trades.delivery.overdue',
  1,
  z.object({
    tradeId: uuidSchema,
    tradeCode: tradeCodeSchema,
    deadlineId: uuidSchema,
    status: z.enum(['FUNDED', 'SHIPPED']),
    dueAt: z.iso.datetime(),
    refundRequested: z.boolean(),
  }),
);

/**
 * A trade asks for its escrow back (DE4 today; T-066's approved cancellation and seller-cannot-
 * fulfil refunds publish the same event with their own reason, so T-075 has one intake). The
 * reasons are the post-funding values of `cancellation_reason`. No amount: see the header.
 */
export const tradeRefundRequestedEvent = defineEvent(
  'trades.refund.requested',
  1,
  z.object({
    tradeId: uuidSchema,
    tradeCode: tradeCodeSchema,
    reason: z.enum(['DELIVERY_OVERDUE', 'SELLER_CANNOT_FULFIL', 'MUTUAL_AGREEMENT']),
    scope: z.literal('FULL'),
    deadlineId: uuidSchema.optional(),
  }),
);
