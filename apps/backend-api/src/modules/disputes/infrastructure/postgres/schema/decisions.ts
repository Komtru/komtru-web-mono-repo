// M3 §4.4, append-only (D6). Never UPDATEd and never DELETEd: an appeal that overturns the original
// is a NEW row referencing the same dispute, not a correction of the old one. The trigger that
// enforces that, and the one that checks the two amounts against the case's escrowed total, are
// installed by the custom migration alongside this table.
import { sql } from 'drizzle-orm';
import { bigint, bigserial, check, index, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { disputes } from './columns.js';
import { disputeCases } from './disputes.js';
import { appealOutcome, decisionOutcome, decisionType } from './enums.js';

export const disputeDecisionLog = disputes.table(
  'dispute_decision_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    disputeId: uuid('dispute_id')
      .notNull()
      .references(() => disputeCases.id, { onDelete: 'cascade' }),
    decisionType: decisionType('decision_type').notNull(),
    /** Null for a MEDIATED decision: the parties agreed it, so no reviewer decided it. */
    decidedByUserId: uuid('decided_by_user_id'),
    outcome: decisionOutcome('outcome').notNull(),
    amountToBuyerMinor: bigint('amount_to_buyer_minor', { mode: 'bigint' }).notNull(),
    amountToSellerMinor: bigint('amount_to_seller_minor', { mode: 'bigint' }).notNull(),
    /** Set only when decision_type = 'APPEAL'. */
    appealOutcome: appealOutcome('appeal_outcome'),
    rationale: text('rationale').notNull(),
    /** Q10: "replacement" and "refund with return", kept as the agreed words they are. */
    agreedNote: text('agreed_note'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'dispute_decision_amounts_nonnegative',
      sql`${table.amountToBuyerMinor} >= 0 AND ${table.amountToSellerMinor} >= 0`,
    ),
    check('dispute_decision_rationale_not_blank', sql`length(btrim(${table.rationale})) > 0`),
    // An appeal outcome on an original decision, or an appeal with none, would make the log
    // ambiguous about what was actually decided.
    check(
      'dispute_decision_appeal_outcome_matches_type',
      sql`(${table.decisionType} = 'APPEAL') = (${table.appealOutcome} IS NOT NULL)`,
    ),
    // A reviewer decides; the parties agree. Exactly one of those is true of any row.
    check(
      'dispute_decision_decider_matches_type',
      sql`(${table.decisionType} = 'MEDIATED') = (${table.decidedByUserId} IS NULL)`,
    ),
    index('dispute_decision_log_dispute_idx').on(table.disputeId, table.decidedAt, table.id),
  ],
);
