// The only way money is written. Everything about a posting that has to be true at once — the
// journal entry, its lines, and the event announcing them — happens in the caller's transaction, so
// a crash between any two of them leaves nothing behind.
//
// The balance invariant is enforced three deep, and that is deliberate: `assertBalanced` here so a
// caller's bug surfaces on the caller's own stack; the deferred constraint triggers (migration
// 0017) so the same bug written straight to the tables still cannot commit; and `line_count` so a
// posting that commits is the whole posting and nothing can be added to it afterwards.
import { koboToJson } from '@komtru/shared-types';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { ledgerJournalPostedEvent } from '../domain/events.js';
import { assertBalanced, postJournalInputSchema, type PostJournalInput } from '../domain/journal.js';
import {
  claimJournalEntry,
  findEntriesByJournal,
  insertEntries,
  type JournalEntryRow,
  type LedgerEntryRow,
} from '../infrastructure/postgres/journalRepository.js';

export interface PostedJournal {
  journalEntry: JournalEntryRow;
  lines: LedgerEntryRow[];
  /** False when a previous posting already owned this idempotency key: nothing was written. */
  posted: boolean;
}

/**
 * Posts one balanced journal entry, once per idempotency key. A retry with a key that is already
 * taken returns the original posting and writes nothing — no second entry and no second event,
 * because the first post already published.
 */
export async function postJournal(tx: Tx, input: PostJournalInput): Promise<PostedJournal> {
  const parsed = postJournalInputSchema.parse(input);
  assertBalanced(parsed.lines);

  const { row, claimed } = await claimJournalEntry(tx, {
    idempotencyKey: parsed.idempotencyKey,
    description: parsed.description,
    lineCount: parsed.lines.length,
    currency: parsed.currency,
    tradeId: parsed.tradeId,
    escrowActionRequestId: parsed.escrowActionRequestId,
    provider: parsed.provider,
    providerReference: parsed.providerReference,
    createdBy: parsed.createdBy,
  });

  if (!claimed) {
    return { journalEntry: row, lines: await findEntriesByJournal(tx, row.id), posted: false };
  }

  const lines = await insertEntries(tx, row.id, parsed.lines, parsed.currency);

  await publish(tx, ledgerJournalPostedEvent, {
    aggregateType: 'ledger_journal_entry',
    aggregateId: row.id,
    correlationId: parsed.correlationId,
    causationId: parsed.causationId,
    actor: parsed.actor,
    payload: {
      journalEntryId: row.id,
      idempotencyKey: row.idempotencyKey,
      description: row.description,
      currency: row.currency,
      tradeId: row.tradeId,
      escrowActionRequestId: row.escrowActionRequestId,
      provider: row.provider,
      providerReference: row.providerReference,
      postedAt: row.postedAt.toISOString(),
      lines: lines.map((line) => ({
        accountKey: line.accountKey,
        accountType: line.accountType,
        direction: line.direction,
        amountMinor: koboToJson(line.amountMinor),
      })),
    },
  });

  return { journalEntry: row, lines, posted: true };
}
