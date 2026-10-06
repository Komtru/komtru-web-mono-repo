// Two append-only logs (migration 0017). `trade_state_changes` answers "how did this trade get
// here"; `trade_activity` answers "what has happened on it", including the rejections m2 §13.1 had
// nowhere to put (conflict C6).
//
// No foreign key to identity: an actor id is a soft reference across schemas. The foreign key to
// `trades` is real and cascades — but a cascaded DELETE fires the append-only trigger, so once a
// trade has any history it cannot be deleted by anyone, the owner included. That is the intended
// outcome: the evidence outlives the row it describes.
import { sql } from 'drizzle-orm';
import { bigserial, check, index, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { trade } from './columns.js';
import { tradeAction, tradeActivityType, tradeActorType, tradeStatus } from './enums.js';
import { trades } from './trades.js';

/**
 * Written by the `trade_record_state_change` trigger (migration 0018) and by nothing else: a direct
 * INSERT is refused in migration 0021, because an audit trail anyone can write to is one anyone can
 * forge. Every transition lands here, the counter-proposal included — the triggers key on
 * `status_revision`, not on `status`, so the one transition that leaves the status where it was is
 * still recorded (with `from_status` = `to_status`).
 */
export const tradeStateChanges = trade.table(
  'trade_state_changes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    fromStatus: tradeStatus('from_status'),
    toStatus: tradeStatus('to_status').notNull(),
    action: tradeAction('action').notNull(),
    actorType: tradeActorType('actor_type').notNull(),
    actorId: uuid('actor_id'),
    reason: text('reason'),
    metadata: jsonb('metadata'),
  },
  (table) => [
    // A human actor without an id is an audit row that lies by omission: only the system and the
    // ledger act without one.
    check(
      'trade_state_changes_actor_identified',
      sql`${table.actorId} IS NOT NULL OR ${table.actorType} IN ('SYSTEM', 'LEDGER')`,
    ),
    index('trade_state_changes_trade_idx').on(table.tradeId, table.occurredAt.desc().nullsFirst()),
  ],
);

export const tradeActivity = trade.table(
  'trade_activity',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    type: tradeActivityType('type').notNull(),
    actorType: tradeActorType('actor_type').notNull(),
    actorId: uuid('actor_id'),
    /** The terms version an activity is about, where there is one. Soft within the schema on
     * purpose: the row must survive a fixture deleting versions. */
    termsVersionId: uuid('terms_version_id'),
    /** Human-readable, shown on the trade timeline; a decline or rejection reason lands here. */
    summary: text('summary'),
    metadata: jsonb('metadata'),
  },
  (table) => [
    index('trade_activity_trade_idx').on(table.tradeId, table.occurredAt.desc().nullsFirst()),
    index('trade_activity_type_idx').on(table.type, table.occurredAt.desc().nullsFirst()),
  ],
);
