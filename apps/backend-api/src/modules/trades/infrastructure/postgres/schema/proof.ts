// The seller's proof of the item (T-061, HTML W1): mandatory before a trade can reach
// PENDING_PAYMENT. One row per M20 file; the bytes stay in files, this only says which files a
// trade's seller put forward and who attached them.
import { index, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { trade } from './columns.js';
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
