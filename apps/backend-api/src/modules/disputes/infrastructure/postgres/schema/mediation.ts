// C13's mediation, which M3 does not have: before a reviewer sees anything, each party may propose
// one of M3's four money outcomes and the other may accept it. An accepted proposal resolves the
// case without review; the window lapsing sends it to evidence instead.
import { sql } from 'drizzle-orm';
import { bigint, check, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { disputes } from './columns.js';
import { disputeCases } from './disputes.js';
import { decisionOutcome, mediationProposalStatus } from './enums.js';

export const disputeMediationProposals = disputes.table(
  'dispute_mediation_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    disputeId: uuid('dispute_id')
      .notNull()
      .references(() => disputeCases.id, { onDelete: 'cascade' }),
    proposedByUserId: uuid('proposed_by_user_id').notNull(),
    outcome: decisionOutcome('outcome').notNull(),
    amountToBuyerMinor: bigint('amount_to_buyer_minor', { mode: 'bigint' }).notNull(),
    amountToSellerMinor: bigint('amount_to_seller_minor', { mode: 'bigint' }).notNull(),
    /**
     * Q10: "replacement" and "refund with return" are not money outcomes, so they ride here as the
     * agreed note on an outcome that IS one, with return shipping self-arranged.
     */
    note: text('note'),
    status: mediationProposalStatus('status').notNull().default('PROPOSED'),
    respondedByUserId: uuid('responded_by_user_id'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'dispute_mediation_amounts_nonnegative',
      sql`${table.amountToBuyerMinor} >= 0 AND ${table.amountToSellerMinor} >= 0`,
    ),
    check(
      'dispute_mediation_answered_together',
      sql`(${table.status} = 'PROPOSED') = (${table.respondedAt} IS NULL)`,
    ),
    /**
     * One live proposal per party. Without this, a party could stack offers and the other side
     * would be accepting one of several things at once — and two accepts racing would be two
     * resolutions of the same case.
     */
    uniqueIndex('dispute_mediation_one_open_per_party')
      .on(table.disputeId, table.proposedByUserId)
      .where(sql`${table.status} = 'PROPOSED'`),
    index('dispute_mediation_dispute_idx').on(table.disputeId, table.createdAt, table.id),
  ],
);
