// M3 §4.3. A row is a reference, never bytes: the file itself lives in M20 under
// `DISPUTE_EVIDENCE` / `PRIVATE_CASE`, granted to the two parties and the assigned reviewer.
import { sql } from 'drizzle-orm';
import { boolean, check, index, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { disputes } from './columns.js';
import { disputeCases } from './disputes.js';

export const disputeEvidence = disputes.table(
  'dispute_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    disputeId: uuid('dispute_id')
      .notNull()
      .references(() => disputeCases.id, { onDelete: 'cascade' }),
    submittedByUserId: uuid('submitted_by_user_id').notNull(),
    /** Soft reference to files.file_records(id); null when the party only wrote something. */
    fileRefId: uuid('file_ref_id'),
    note: text('note'),
    /**
     * M3 D2: late evidence is not silently accepted. It exists only because a reviewer reopened
     * collection, and it is stored flagged so the decision can show what arrived after the window.
     */
    submittedAfterDeadline: boolean('submitted_after_deadline').notNull().default(false),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'dispute_evidence_has_content',
      sql`${table.fileRefId} IS NOT NULL OR length(btrim(coalesce(${table.note}, ''))) > 0`,
    ),
    index('dispute_evidence_dispute_idx').on(table.disputeId, table.submittedAt, table.id),
    // The evidence-comparison read model (T-081) splits by party, so it gets its own index.
    index('dispute_evidence_party_idx').on(table.disputeId, table.submittedByUserId, table.submittedAt),
  ],
);
