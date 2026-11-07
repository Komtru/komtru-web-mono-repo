import { sql } from 'drizzle-orm';
import { check, index, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { caseIndex } from './cases.js';
import { cases } from './columns.js';
import { evidenceRequestStatus } from './enums.js';

/** What staff asked for and from whom. The evidence itself is a file the files module holds. */
export const caseEvidenceRequests = cases.table(
  'case_evidence_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => caseIndex.id),
    description: text('description').notNull(),
    /** Soft reference to identity.users(id): the party being asked. Null when it is internal. */
    fromUserId: uuid('from_user_id'),
    requestedByUserId: uuid('requested_by_user_id').notNull(),
    status: evidenceRequestStatus('status').notNull().default('OPEN'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    resolvedByUserId: uuid('resolved_by_user_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('case_evidence_requests_description_not_blank', sql`length(btrim(${table.description})) > 0`),
    check(
      'case_evidence_requests_resolved_together',
      sql`(${table.status} = 'OPEN') = (${table.resolvedAt} IS NULL)`,
    ),
    index('case_evidence_requests_case_idx').on(table.caseId, table.createdAt),
  ],
);
