// Delivery signals (M7 §4.4, trust-weighted in §6) and the scheduled deadlines design §6.2 names.
// The weighting itself — which source may move a trade to INSPECTION rather than
// UNCONFIRMED_DELIVERY, and the partner-history exception — is T-064's consumer; this ticket owns
// the record it reads.
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { trade } from './columns.js';
import {
  deliveryExtensionReason,
  deliveryExtensionStatus,
  deliverySignalSource,
  inspectionExtensionStatus,
  tradeActorType,
  tradeDeadlineKind,
  tradeDeadlineStatus,
} from './enums.js';
import { trades } from './trades.js';

export const deliverySignals = trade.table(
  'delivery_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    source: deliverySignalSource('source').notNull(),
    /** Set for BUYER_CONFIRMATION and SELLER_SELF_REPORT. */
    reportedBy: uuid('reported_by'),
    /** m2's shipment_status_events / park custody event, for the partner sources. */
    shipmentEventId: uuid('shipment_event_id'),
    evidence: jsonb('evidence'),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('delivery_signals_trade_idx').on(table.tradeId, table.reportedAt.desc().nullsFirst()),
    // A courier webhook is delivered at least once; a replay must not count as a second signal.
    uniqueIndex('delivery_signals_shipment_event')
      .on(table.tradeId, table.source, table.shipmentEventId)
      .where(sql`${table.shipmentEventId} IS NOT NULL`),
  ],
);

/**
 * One row per scheduled deadline. The jobs that fire them are idempotent and re-check state and
 * holds (design §6.2), which is why the deadline is a row rather than a timestamp on the trade:
 * an extension (DE1/DE2, BEI1) has to leave evidence of who asked and who agreed.
 */
export const tradeDeadlines = trade.table(
  'trade_deadlines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    kind: tradeDeadlineKind('kind').notNull(),
    status: tradeDeadlineStatus('status').notNull().default('PENDING'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    originalDueAt: timestamp('original_due_at', { withTimezone: true }).notNull(),
    extensionCount: integer('extension_count').notNull().default(0),
    extendedByActorType: tradeActorType('extended_by_actor_type'),
    extendedByActorId: uuid('extended_by_actor_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('trade_deadlines_extensions_non_negative', sql`${table.extensionCount} >= 0`),
    // An extension only ever moves a deadline later (DE2, BEI1).
    check('trade_deadlines_never_shortened', sql`${table.dueAt} >= ${table.originalDueAt}`),
    // Two pending deadlines of one kind would fire twice; the second insert loses here rather than
    // in whichever job happens to run first.
    uniqueIndex('trade_deadlines_one_pending')
      .on(table.tradeId, table.kind)
      .where(sql`${table.status} = 'PENDING'`),
    index('trade_deadlines_due_idx')
      .on(table.dueAt)
      .where(sql`${table.status} = 'PENDING'`),
  ],
);

/**
 * X2's evidence for a shipment the seller arranged themselves (the permanent "arrange my own
 * shipping" option). Append-only: a waybill that can be edited after the fact is not evidence, and a
 * dispute (T-080) reads this row. One per trade, so a replayed request cannot add a second.
 */
export const selfArrangedShipments = trade.table(
  'self_arranged_shipments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // restrict, not cascade: the table is append-only, so a cascaded delete would be refused by the
    // trigger anyway. Say so.
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'restrict' }),
    waybillNumber: text('waybill_number').notNull(),
    /** files.file_records(id): the photo of the waybill receipt. A soft reference (design §4.2). */
    receiptFileId: uuid('receipt_file_id').notNull(),
    /** E.164. */
    driverPhone: text('driver_phone').notNull(),
    vehiclePlate: text('vehicle_plate').notNull(),
    shippedByUserId: uuid('shipped_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('self_arranged_shipments_trade').on(table.tradeId),
    // One photo is evidence for one shipment; the service checks first for a good error, this is the
    // guard two concurrent shipments cannot both pass.
    uniqueIndex('self_arranged_receipt_file').on(table.receiptFileId),
    check('self_arranged_waybill_length', sql`char_length(${table.waybillNumber}) BETWEEN 3 AND 60`),
    check('self_arranged_phone_e164', sql`${table.driverPhone} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check('self_arranged_plate_length', sql`char_length(${table.vehiclePlate}) BETWEEN 3 AND 14`),
  ],
);

/**
 * DE1/DE2: the seller asks for more time on a delivery deadline, the buyer answers. The deadline row
 * itself only moves on acceptance; this row is the evidence of who asked, why, and who agreed.
 */
export const deliveryExtensionRequests = trade.table(
  'delivery_extension_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    deadlineId: uuid('deadline_id')
      .notNull()
      .references(() => tradeDeadlines.id, { onDelete: 'cascade' }),
    requestedByUserId: uuid('requested_by_user_id').notNull(),
    reason: deliveryExtensionReason('reason').notNull(),
    note: text('note'),
    /** The deadline as it stood when asked, kept so the buyer's screen shows the same "from". */
    currentDueAt: timestamp('current_due_at', { withTimezone: true }).notNull(),
    requestedDueAt: timestamp('requested_due_at', { withTimezone: true }).notNull(),
    status: deliveryExtensionStatus('status').notNull().default('PENDING'),
    respondedByUserId: uuid('responded_by_user_id'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('delivery_extension_later', sql`${table.requestedDueAt} > ${table.currentDueAt}`),
    check(
      'delivery_extension_answered',
      sql`(${table.status} IN ('ACCEPTED', 'DECLINED')) = (${table.respondedAt} IS NOT NULL)`,
    ),
    // One open question per deadline: the buyer is never asked twice at once.
    uniqueIndex('delivery_extension_one_pending')
      .on(table.deadlineId)
      .where(sql`${table.status} = 'PENDING'`),
    index('delivery_extension_trade_idx').on(table.tradeId, table.createdAt.desc().nullsFirst()),
  ],
);

/**
 * BEI1/BEI2: the buyer asks the seller for more inspection time, the seller answers. The deadline row
 * itself only moves on acceptance; this row is the evidence of who asked, how much, and who agreed.
 * One row per inspection deadline, ever: a request that was declined or lapsed cannot be repeated,
 * and two concurrent requests cannot both land. "Once" is enforced here, not only in the service.
 */
export const inspectionExtensionRequests = trade.table(
  'inspection_extension_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    deadlineId: uuid('deadline_id')
      .notNull()
      .references(() => tradeDeadlines.id, { onDelete: 'cascade' }),
    requestedByUserId: uuid('requested_by_user_id').notNull(),
    extraHours: integer('extra_hours').notNull(),
    note: text('note'),
    /** The deadline as it stood when asked, so the seller's screen shows the same "from". */
    currentDueAt: timestamp('current_due_at', { withTimezone: true }).notNull(),
    requestedDueAt: timestamp('requested_due_at', { withTimezone: true }).notNull(),
    status: inspectionExtensionStatus('status').notNull().default('PENDING'),
    respondedByUserId: uuid('responded_by_user_id'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('inspection_extension_hours_positive', sql`${table.extraHours} > 0`),
    check('inspection_extension_later', sql`${table.requestedDueAt} > ${table.currentDueAt}`),
    check(
      'inspection_extension_answered',
      sql`(${table.status} IN ('ACCEPTED', 'DECLINED')) = (${table.respondedAt} IS NOT NULL)`,
    ),
    uniqueIndex('inspection_extension_once').on(table.deadlineId),
    index('inspection_extension_trade_idx').on(table.tradeId, table.createdAt.desc().nullsFirst()),
  ],
);

/**
 * Z5's explicit acknowledgement: the buyer was shown that release is final and said so. Append-only
 * (the trigger in migration 0046), one per trade, and a dispute reads it as evidence. A trade that
 * auto-completed (AR1) has none, which is the difference between the two routes.
 */
export const inspectionAcknowledgements = trade.table(
  'inspection_acknowledgements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'restrict' }),
    buyerUserId: uuid('buyer_user_id').notNull(),
    /** Which wording was on screen, so the evidence says what the buyer agreed to. */
    statementCode: text('statement_code').notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('inspection_acknowledgements_trade').on(table.tradeId),
    check('inspection_ack_statement_length', sql`char_length(${table.statementCode}) BETWEEN 1 AND 60`),
  ],
);
