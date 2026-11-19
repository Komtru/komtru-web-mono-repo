// M3 §4.5, append-only: every move the case made, who made it and when. This is what the party's
// timeline (Customer-8, CWT-S15) and the reviewer's trail are drawn from, so a transition that is
// not recorded here is one no screen can explain.
import { sql } from 'drizzle-orm';
import { bigserial, check, index, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { disputes } from './columns.js';
import { disputeCases } from './disputes.js';
import { disputeActorType, disputeStatus } from './enums.js';

export const disputeStatusChanges = disputes.table(
  'dispute_status_changes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    disputeId: uuid('dispute_id')
      .notNull()
      .references(() => disputeCases.id, { onDelete: 'cascade' }),
    /** Null on the opening row: the case did not come from anywhere. */
    fromStatus: disputeStatus('from_status'),
    toStatus: disputeStatus('to_status').notNull(),
    /** The DISPUTE_ACTIONS name, so a withdrawal and a lapsed appeal window read differently. */
    action: text('action').notNull(),
    actorType: disputeActorType('actor_type').notNull(),
    /** Null for SYSTEM (a deadline sweep). */
    actorId: uuid('actor_id'),
    reason: text('reason'),
  },
  (table) => [
    check('dispute_status_changes_action_not_blank', sql`length(btrim(${table.action})) > 0`),
    check(
      'dispute_status_changes_system_has_no_actor',
      sql`(${table.actorType} = 'SYSTEM') = (${table.actorId} IS NULL)`,
    ),
    index('dispute_status_changes_dispute_idx').on(table.disputeId, table.id),
  ],
);
