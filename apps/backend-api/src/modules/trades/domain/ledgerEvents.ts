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
 * Only the fields the transition records are read; the amounts stay the ledger's.
 */
export const ledgerEscrowFundedEvent = defineEvent(
  'ledger.payment.escrow_funded',
  1,
  z.object({
    tradeId: z.uuid(),
    paymentAttemptId: z.uuid(),
    journalEntryId: z.uuid(),
    reference: z.string().min(1),
  }),
);
