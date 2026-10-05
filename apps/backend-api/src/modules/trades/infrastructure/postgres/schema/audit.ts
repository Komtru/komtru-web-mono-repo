// Two append-only logs (migration 0017). `trade_state_changes` answers "how did this trade get
// here"; `trade_activity` answers "what has happened on it", including the rejections m2 §13.1 had
// nowhere to put (conflict C6).
//
// No foreign key to identity: an actor id is a soft reference across schemas. The foreign key to
// `trades` is real and cascades, because a trade row is never deleted in production — the cascade
// exists so a test fixture can clean up without leaving orphans.
import { bigserial, index, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { trade } from './columns.js';
import { tradeAction, tradeActivityType, tradeActorType, tradeStatus } from './enums.js';
import { trades } from './trades.js';

/**
 * Written by the `trade_record_state_change` trigger (migration 0018), never by a service: an audit
 * trail that depends on every caller remembering to write it is decorative. A counter-proposal is
 * the one transition that does not land here, because it leaves the status where it was; it is
 * recorded in `trade_activity` as COUNTER_PROPOSED.
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
  (table) => [index('trade_state_changes_trade_idx').on(table.tradeId, table.occurredAt.desc().nullsFirst())],
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
