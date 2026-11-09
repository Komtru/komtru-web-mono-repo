import { sql } from 'drizzle-orm';
import { check, index, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { caseIndex } from './cases.js';
import { cases } from './columns.js';

/**
 * Append-only (migration 0041). Only a signed-in staff member's decision route writes here; the
 * advisory path cannot, and the citation is part of the row so a decision without a policy behind
 * it is not a row at all.
 */
export const caseDecisions = cases.table(
  'case_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => caseIndex.id),
    /** Soft reference to identity.users(id). Always a person. */
    decidedByUserId: uuid('decided_by_user_id').notNull(),
    /** The owning module's vocabulary (`REFUND_BUYER`, `APPROVE`, `REJECT`): this index only carries it. */
    outcome: text('outcome').notNull(),
    reason: text('reason').notNull(),
    policyCitation: text('policy_citation').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('case_decisions_outcome_not_blank', sql`length(btrim(${table.outcome})) > 0`),
    check('case_decisions_reason_not_blank', sql`length(btrim(${table.reason})) > 0`),
    check('case_decisions_citation_not_blank', sql`length(btrim(${table.policyCitation})) > 0`),
    index('case_decisions_case_idx').on(table.caseId, table.decidedAt),
  ],
);
