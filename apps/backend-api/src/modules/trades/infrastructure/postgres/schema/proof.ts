// The seller's proof of the item (T-061, HTML W1): mandatory before a trade can reach
// PENDING_PAYMENT. One row per M20 file; the bytes stay in files, this only says which files a
// trade's seller put forward and who attached them.
import { index, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { trade } from './columns.js';
import { tradeEvidenceEvent, tradeInitiatorRole } from './enums.js';
import { trades } from './trades.js';

export const tradeProofMedia = trade.table(
  'trade_proof_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    /** files.file_records(id): a soft reference across schemas (design §4.2). */
    fileId: uuid('file_id').notNull(),
    attachedByUserId: uuid('attached_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('trade_proof_media_trade_file').on(table.tradeId, table.fileId),
    index('trade_proof_media_trade_idx').on(table.tradeId),
  ],
);

/**
 * Evidence the parties add once the item is moving (F-028, CWT-S13): dispatch, delivery, inspection and issue media.
 * A sibling of `trade_proof_media` rather than a column on it, because every reader of that table means "the
 * seller's proof": the proof gate, the grant and revoke around send/accept/decline, the Z4 comparison. Mixing
 * categories in one table would put a filter in each of them. One row per M20 file; `file_id` is unique, so a file
 * is evidence once, on one trade.
 */
export const tradeEvidenceMedia = trade.table(
  'trade_evidence_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    /** files.file_records(id): a soft reference across schemas (design §4.2). */
    fileId: uuid('file_id').notNull(),
    event: tradeEvidenceEvent('event').notNull(),
    attachedByUserId: uuid('attached_by_user_id').notNull(),
    /** Fixed when the file is attached, so a read never has to re-derive who was the buyer. */
    attachedByRole: tradeInitiatorRole('attached_by_role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('trade_evidence_media_file').on(table.fileId),
    index('trade_evidence_media_trade_event_idx').on(table.tradeId, table.event, table.createdAt),
  ],
);
