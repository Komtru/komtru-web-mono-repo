// The trade: the financial and trust container (M7 §1), reconciled with design §6.
//
// Two deliberate deviations from M7 §4.2:
//   * there is no live `amount_minor`. A counter-proposal changes the price, so the proposed price
//     lives on the immutable terms version; the money columns here are the fee snapshot (§6.5) and
//     nothing else, frozen at acceptance so a later config/fees.yaml edit cannot restate an open
//     trade's maths;
//   * `buyer_user_id` and `seller_user_id` are not a strict XOR against the invitation. The
//     invitation id stays after it is claimed, because "who was invited" is audit evidence, and the
//     party-binding rule is expressed against `status` instead (trades_parties_bound).
//
// Cross-schema references (buyer, seller, invitation, order, category) are plain uuid columns with
// no REFERENCES (design §4.2).
import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { trade } from './columns.js';
import { cancellationReason, tradeAction, tradeActorType, tradeInitiatorRole, tradeStatus } from './enums.js';

/** Statuses a trade can hold before its terms are accepted, so before it has a fee snapshot. */
const BEFORE_ACCEPTANCE = sql`('DRAFT', 'PENDING_COUNTERPARTY', 'UNDER_PROPOSAL_REVIEW', 'AWAITING_ACCEPTANCE', 'DECLINED', 'REJECTED', 'CANCELLED', 'EXPIRED')`;

/** Statuses a trade can hold while its counterparty is still an unclaimed invitation. */
const BEFORE_BINDING = sql`('DRAFT', 'PENDING_COUNTERPARTY', 'EXPIRED', 'CANCELLED')`;

export const trades = trade.table(
  'trades',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** `KMT-7398512-NG` (shared-types `tradeCodeSchema`). Random, never sequential. */
    tradeCode: text('trade_code').notNull().unique(),

    /** The person who started the trade and the side they chose (design §6.3). */
    initiatorUserId: uuid('initiator_user_id').notNull(),
    initiatorRole: tradeInitiatorRole('initiator_role').notNull(),

    buyerUserId: uuid('buyer_user_id'),
    sellerUserId: uuid('seller_user_id'),
    /** identity.party_invitations(id) while the counterparty has no account yet (M7 D2). */
    counterpartyInvitationId: uuid('counterparty_invitation_id'),

    /** M9's order, M19's category and the Trade Standards version this trade was created under. */
    orderId: uuid('order_id'),
    categoryId: uuid('category_id'),
    tradeStandardVersion: integer('trade_standard_version'),

    status: tradeStatus('status').notNull().default('DRAFT'),
    /** Bumped by every transition, including the counter-proposal that leaves `status` where it
     * is. The triggers in migration 0018 key on this rather than on `status`, so a self-transition
     * is guarded and audited like any other, and a status written without a bump is refused. It is
     * also the optimistic-concurrency token a self-transition needs: `status` alone cannot tell two
     * simultaneous counter-proposals apart. */
    statusRevision: integer('status_revision').notNull().default(0),
    /** Stamped by the guard trigger, so a caller learns what the trade left without reading the
     * audit log back — and cannot be told something the UPDATE did not do. */
    previousStatus: tradeStatus('previous_status'),
    /** The action that produced `status`; NULL only for a trade that has never moved. */
    statusAction: tradeAction('status_action'),
    statusActorType: tradeActorType('status_actor_type'),
    statusActorId: uuid('status_actor_id'),
    statusReason: text('status_reason'),
    statusContext: jsonb('status_context'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull().defaultNow(),

    currency: text('currency').notNull().default('NGN'),

    /** Integers from Trade Standards (T-049), snapshotted here (resolves m2 §13.3). */
    inspectionWindowHours: integer('inspection_window_hours').notNull(),
    deliveryGraceHours: integer('delivery_grace_hours').notNull(),

    /** The latest proposal, and the one acceptance pinned. A plain foreign key on either column
     * would accept another trade's version, so both carry the trade id in a composite key
     * (migration 0020); drizzle expresses neither that nor its deferred ON DELETE SET NULL. */
    currentTermsVersionId: uuid('current_terms_version_id'),
    acceptedTermsVersionId: uuid('accepted_terms_version_id'),

    /** The fee snapshot (§6.5). All nine columns are written together, at acceptance, and frozen
     * afterwards by the trigger in migration 0019. Values come from the fee module's
     * `snapshotFees(...)` (T-047); this module computes no fee of its own. The columns carry the
     * same names as the calculator's, so the ledger reads one vocabulary; `fee_snapshot` holds the
     * whole `FeeSnapshot` verbatim, amounts as digit strings, because a JSON number loses kobo
     * past 2^53. */
    feeScheduleVersion: text('fee_schedule_version'),
    itemAmountMinor: bigint('item_amount_minor', { mode: 'bigint' }),
    buyerProtectionFeeMinor: bigint('buyer_protection_fee_minor', { mode: 'bigint' }),
    buyerTotalMinor: bigint('buyer_total_minor', { mode: 'bigint' }),
    commissionMinor: bigint('commission_minor', { mode: 'bigint' }),
    sellerProceedsMinor: bigint('seller_proceeds_minor', { mode: 'bigint' }),
    platformRevenueMinor: bigint('platform_revenue_minor', { mode: 'bigint' }),
    feeSnapshot: jsonb('fee_snapshot'),
    feesSnapshottedAt: timestamp('fees_snapshotted_at', { withTimezone: true }),

    sentAt: timestamp('sent_at', { withTimezone: true }),
    counterpartyBoundAt: timestamp('counterparty_bound_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    fundedAt: timestamp('funded_at', { withTimezone: true }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    deliverySignalledAt: timestamp('delivery_signalled_at', { withTimezone: true }),
    deliveryConfirmedAt: timestamp('delivery_confirmed_at', { withTimezone: true }),
    inspectionStartedAt: timestamp('inspection_started_at', { withTimezone: true }),
    inspectionDeadlineAt: timestamp('inspection_deadline_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: cancellationReason('cancellation_reason'),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
    disputedAt: timestamp('disputed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('trades_code_format', sql`${table.tradeCode} ~ '^KMT-[0-9]{5,8}-NG$'`),
    check('trades_currency', sql`${table.currency} = 'NGN'`),
    // Trading with yourself would make escrow a loop and every gate meaningless.
    check(
      'trades_parties_distinct',
      sql`${table.buyerUserId} IS NULL OR ${table.sellerUserId} IS NULL
          OR ${table.buyerUserId} <> ${table.sellerUserId}`,
    ),
    // The initiator occupies the side they chose; the counterparty takes the other (design §6.3).
    check(
      'trades_initiator_side',
      sql`(${table.initiatorRole} = 'BUYER' AND ${table.buyerUserId} = ${table.initiatorUserId})
          OR (${table.initiatorRole} = 'SELLER' AND ${table.sellerUserId} = ${table.initiatorUserId})`,
    ),
    // Both parties are real people from the moment the counterparty claims, and certainly before
    // money moves: a funded trade with one side missing has nowhere to pay out to.
    check(
      'trades_parties_bound',
      sql`(${table.buyerUserId} IS NOT NULL AND ${table.sellerUserId} IS NOT NULL)
          OR ${table.status} IN ${BEFORE_BINDING}`,
    ),
    check(
      'trades_window_positive',
      sql`${table.inspectionWindowHours} > 0 AND ${table.deliveryGraceHours} > 0`,
    ),
    // The snapshot is written in one piece or not at all; half a snapshot is a wrong total.
    check(
      'trades_fee_snapshot_complete',
      sql`num_nonnulls(${table.feeScheduleVersion}, ${table.itemAmountMinor}, ${table.buyerProtectionFeeMinor},
                      ${table.buyerTotalMinor}, ${table.commissionMinor}, ${table.sellerProceedsMinor},
                      ${table.platformRevenueMinor}, ${table.feeSnapshot}, ${table.feesSnapshottedAt})
           IN (0, 9)`,
    ),
    // §6.4's arithmetic, re-checked by the database: the buyer funds the item plus the protection
    // fee, the seller is credited the item minus the commission.
    check(
      'trades_fee_snapshot_arithmetic',
      sql`${table.feeScheduleVersion} IS NULL
          OR (${table.itemAmountMinor} > 0
              AND ${table.buyerProtectionFeeMinor} >= 0
              AND ${table.commissionMinor} >= 0
              AND ${table.sellerProceedsMinor} >= 0
              AND ${table.buyerTotalMinor} = ${table.itemAmountMinor} + ${table.buyerProtectionFeeMinor}
              AND ${table.sellerProceedsMinor} = ${table.itemAmountMinor} - ${table.commissionMinor}
              AND ${table.platformRevenueMinor} = ${table.buyerProtectionFeeMinor} + ${table.commissionMinor})`,
    ),
    // A buyer never sees a total that can still change: no trade reaches PENDING_PAYMENT, and so
    // none is ever funded, without its fees frozen (§6.5).
    check(
      'trades_fees_before_payment',
      sql`${table.feeScheduleVersion} IS NOT NULL OR ${table.status} IN ${BEFORE_ACCEPTANCE}`,
    ),
    // Fees frozen against no agreed price would be a total nobody signed: the pinned terms version
    // is the only record of what the two parties actually agreed to.
    check(
      'trades_terms_before_payment',
      sql`${table.acceptedTermsVersionId} IS NOT NULL OR ${table.status} IN ${BEFORE_ACCEPTANCE}`,
    ),
    // One trades list across both sides (design C22), newest first.
    index('trades_buyer_idx').on(table.buyerUserId, table.createdAt.desc().nullsFirst()),
    index('trades_seller_idx').on(table.sellerUserId, table.createdAt.desc().nullsFirst()),
    index('trades_status_idx').on(table.status),
    index('trades_inspection_deadline_idx')
      .on(table.inspectionDeadlineAt)
      .where(sql`${table.status} = 'INSPECTION'`),
  ],
);
