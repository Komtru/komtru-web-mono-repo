// The ledger's domain events (design §4.3). Published through the outbox inside the transaction
// that wrote the journal entry, so the posting and the announcement of it either both happen or
// neither does — a consumer that sees this event can rely on the entry being readable.
import { defineEvent, koboSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { ENTRY_DIRECTIONS, LEDGER_ACCOUNT_TYPES, PAYMENT_PROVIDERS } from './accounts.js';

const postedLineSchema = z.object({
  /** `NGN:USER_PAYABLE:<uuid>` — the account's canonical name, stable across environments. */
  accountKey: z.string(),
  accountType: z.enum(LEDGER_ACCOUNT_TYPES),
  direction: z.enum(ENTRY_DIRECTIONS),
  /** Kobo as a digit string on the wire, bigint once decoded. */
  amountMinor: koboSchema,
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
