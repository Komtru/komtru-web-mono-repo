// M3 §4.2, plus the four columns C13 and T-080 add: a human case number, the mediation deadline,
// the instant a reviewer reopened evidence collection, and who opened it.
import { sql } from 'drizzle-orm';
import { bigint, check, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { disputes } from './columns.js';
import { disputeCategory, disputeCreationPath, disputeStatus } from './enums.js';

export const disputeCases = disputes.table(
  'dispute_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** `DIS-088213`: the number a party reads out. Never reused, never reset. */
    disputeNumber: bigint('dispute_number', { mode: 'number' }).generatedAlwaysAsIdentity().notNull(),

    /** Soft reference to trade.trades(id). M3 never writes to that table; it emits events. */
    tradeId: uuid('trade_id').notNull(),
    /** Soft reference to orders.orders(id), M9. Null on a single-item trade. */
    orderId: uuid('order_id'),
    /** Soft reference to support.tickets(id); set only for TICKET_ESCALATION. */
    sourceTicketId: uuid('source_ticket_id'),

    /** Soft references to identity.users(id). */
    buyerUserId: uuid('buyer_user_id').notNull(),
    sellerUserId: uuid('seller_user_id').notNull(),
    openedByUserId: uuid('opened_by_user_id').notNull(),

    category: disputeCategory('category').notNull(),
    status: disputeStatus('status').notNull().default('MEDIATION'),
    creationPath: disputeCreationPath('creation_path').notNull(),
    openedReason: text('opened_reason').notNull(),

    /**
     * What the platform is holding, snapshotted from the trade at open time, and the figure D4's
     * two decision amounts must sum to.
     *
     * This is the ITEM amount, not the buyer's total. The ledger funds a trade into two separate
     * liabilities (T-072) — the item in `USER_ESCROW_LIABILITY` and the buyer protection fee in
     * `BUYER_PROTECTION_FEE_LIABILITY` — and is explicit that a settlement debits the item. A
     * dispute divides the item; what becomes of the fee is Q4's rule, applied by the ledger.
     * Flagged for the owner to confirm, because M3 §4.2 says only "total escrowed amount".
     */
    totalEscrowMinor: bigint('total_escrow_minor', { mode: 'bigint' }).notNull(),

    /** C13's window: the parties' own 48 hours before a reviewer is involved at all. */
    mediationDeadlineAt: timestamp('mediation_deadline_at', { withTimezone: true }).notNull(),
    /** M3 D2: one deadline for the case, so the two parties cannot be given different windows. */
    evidenceDeadlineAt: timestamp('evidence_deadline_at', { withTimezone: true }).notNull(),
    /** Set when a reviewer reopens collection for late evidence; the reopen is also on the log. */
    evidenceReopenedAt: timestamp('evidence_reopened_at', { withTimezone: true }),

    assignedReviewerId: uuid('assigned_reviewer_id'),
    assignedAppealLeadId: uuid('assigned_appeal_lead_id'),

    decidedAt: timestamp('decided_at', { withTimezone: true }),
    appealDeadlineAt: timestamp('appeal_deadline_at', { withTimezone: true }),
    appealFiledAt: timestamp('appeal_filed_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('dispute_cases_escrow_positive', sql`${table.totalEscrowMinor} > 0`),
    check('dispute_cases_reason_not_blank', sql`length(btrim(${table.openedReason})) > 0`),
    check('dispute_cases_parties_differ', sql`${table.buyerUserId} <> ${table.sellerUserId}`),
    // A ticket id belongs to a ticket escalation and nothing else: a DIRECT_FILING carrying one
    // would make D1's "two doors, one case" unprovable from the data.
    check(
      'dispute_cases_ticket_only_on_escalation',
      sql`(${table.creationPath} = 'TICKET_ESCALATION') OR (${table.sourceTicketId} IS NULL)`,
    ),
    check(
      'dispute_cases_closed_together',
      sql`(${table.status} = 'CLOSED') = (${table.closedAt} IS NOT NULL)`,
    ),

    uniqueIndex('dispute_cases_number_unique').on(table.disputeNumber),

    /**
     * M3 §4.2 and T-080: at most one non-closed dispute per trade, decided by the database rather
     * than by a service reading and then inserting. Two parties filing in the same instant is the
     * exact race a check-then-insert loses, and the loser must get a 409, not a second case.
     */
    uniqueIndex('dispute_cases_one_active_per_trade')
      .on(table.tradeId)
      .where(sql`${table.status} <> 'CLOSED'`),

    index('dispute_cases_status_idx').on(table.status),
    // The reviewer queue and the "my cases" view read live work only.
    index('dispute_cases_reviewer_idx')
      .on(table.assignedReviewerId, table.createdAt, table.id)
      .where(sql`${table.status} IN ('UNDER_REVIEW', 'APPEAL_UNDER_REVIEW')`),
    index('dispute_cases_queue_idx')
      .on(table.createdAt, table.id)
      .where(sql`${table.status} <> 'CLOSED'`),
    // A party's own list of disputes, both sides, newest first.
    index('dispute_cases_buyer_idx').on(table.buyerUserId, table.createdAt, table.id),
    index('dispute_cases_seller_idx').on(table.sellerUserId, table.createdAt, table.id),
    // The deadline sweeps: each walks one status by one clock, so each gets its own partial index.
    index('dispute_cases_mediation_due_idx')
      .on(table.mediationDeadlineAt)
      .where(sql`${table.status} = 'MEDIATION'`),
    index('dispute_cases_evidence_due_idx')
      .on(table.evidenceDeadlineAt)
      .where(sql`${table.status} = 'OPEN_EVIDENCE_COLLECTION'`),
    index('dispute_cases_appeal_due_idx')
      .on(table.appealDeadlineAt)
      .where(sql`${table.status} = 'DECIDED'`),
  ],
);
