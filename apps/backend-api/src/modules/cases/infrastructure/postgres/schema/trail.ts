import { sql } from 'drizzle-orm';
import { bigserial, check, index, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { caseIndex } from './cases.js';
import { cases } from './columns.js';
import { trailType } from './enums.js';

/**
 * The case's trust trail: who did what, why and when, read in the console's Trust Trail tab and
 * never changed (append-only, migration 0041). Every mutation of a case writes one row in the same
 * transaction as the change.
 */
export const caseTrail = cases.table(
  'case_trail',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => caseIndex.id),
    type: trailType('type').notNull(),
    /** Null for the system (an owning module registering or closing a case). */
    actorUserId: uuid('actor_user_id'),
    reason: text('reason'),
    metadata: jsonb('metadata'),
  },
  (table) => [
    check('case_trail_reason_not_blank', sql`${table.reason} IS NULL OR length(btrim(${table.reason})) > 0`),
    index('case_trail_case_idx').on(table.caseId, table.id),
  ],
);
