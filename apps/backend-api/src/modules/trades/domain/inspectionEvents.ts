// What inspection and completion publish (T-065), through the transactional outbox in the
// transaction that made it true. `trades.trade.state_changed` (to `COMPLETED`) is what the ledger
// releases escrow on; `trades.trade.completed` carries the one thing that event does not, how the
// trade got there, so AR1's "auto-released" notice can differ from a manual confirm.
import { defineEvent, tradeCodeSchema, uuidSchema } from '@komtru/shared-types';
import { z } from 'zod';

export const COMPLETION_ROUTES = ['BUYER_CONFIRMED', 'INSPECTION_ELAPSED'] as const;

export const tradeCompletedEvent = defineEvent(
  'trades.trade.completed',
  1,
  z.object({
    tradeId: uuidSchema,
    tradeCode: tradeCodeSchema,
    via: z.enum(COMPLETION_ROUTES),
    completedAt: z.iso.datetime(),
  }),
);

/** BEI1: the buyer asked for more inspection time. The seller's notification (BEI2) is T-068's. */
export const tradeInspectionExtensionRequestedEvent = defineEvent(
  'trades.inspection_extension.requested',
  1,
  z.object({
    tradeId: uuidSchema,
    tradeCode: tradeCodeSchema,
    requestId: uuidSchema,
    deadlineId: uuidSchema,
    requestedByUserId: uuidSchema,
    extraHours: z.number().int().positive(),
    currentDueAt: z.iso.datetime(),
    requestedDueAt: z.iso.datetime(),
  }),
);

/** BEI2: the seller answered. `newDueAt` is present only when the answer moved the deadline. */
export const tradeInspectionExtensionRespondedEvent = defineEvent(
  'trades.inspection_extension.responded',
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
