// Reads and writes for refunds (T-075). No rule lives here: what a refund posts is
// `domain/refunds.ts`, and migration 0049's triggers refuse an over-refund or a backwards move.
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../../../../db/index.js';
import type { Tx } from '../../../../platform/events/publish.js';
import { paymentAttempts, type PaymentAttemptRow } from './schema/payments.js';
import { refunds, type RefundRow, type RefundStatus } from './schema/refunds.js';

type Reader = Db | Tx;

export type NewRefund = typeof refunds.$inferInsert;
export type RefundChange = Partial<
  Pick<
    RefundRow,
    | 'status'
    | 'providerRefundId'
    | 'lastProviderStatus'
    | 'lastCheckedAt'
    | 'lastError'
    | 'lastErrorAt'
    | 'failureReason'
    | 'failedJournalId'
    | 'dispatchedAt'
    | 'completedAt'
    | 'failedAt'
  >
>;

/**
 * The trade's one settled charge, locked FOR UPDATE until the caller's transaction ends. Every refund
 * decision against a charge takes this first, so two decisions for one trade queue behind each other
 * and the second sees the first. Migration 0049's total guard takes the same lock as its backstop.
 */
export async function lockSettledCharge(tx: Tx, tradeId: string): Promise<PaymentAttemptRow | undefined> {
  const [row] = await tx
    .select()
    .from(paymentAttempts)
    .where(and(eq(paymentAttempts.tradeId, tradeId), eq(paymentAttempts.status, 'SUCCEEDED')))
    .for('update');
  return row;
}

export async function insertRefund(tx: Tx, values: NewRefund): Promise<RefundRow> {
  const [row] = await tx.insert(refunds).values(values).returning();
  if (!row) throw new Error('ledger: refund insert returned no row');
  return row;
}

export async function findRefund(db: Reader, id: string): Promise<RefundRow | undefined> {
  const [row] = await db.select().from(refunds).where(eq(refunds.id, id));
  return row;
}

/** The refund, locked until the caller's transaction ends: what serialises two resolutions of one. */
export async function lockRefund(tx: Tx, id: string): Promise<RefundRow | undefined> {
  const [row] = await tx.select().from(refunds).where(eq(refunds.id, id)).for('update');
  return row;
}

export async function updateRefund(tx: Tx, id: string, change: RefundChange): Promise<RefundRow> {
  const [row] = await tx.update(refunds).set(change).where(eq(refunds.id, id)).returning();
  if (!row) throw new Error(`ledger: refund ${id} vanished during an update`);
  return row;
}

/** The whole-trade refund in force, if any: a FAILED one does not count (`refunds_one_live_full`). */
export async function findLiveFullRefund(db: Reader, tradeId: string): Promise<RefundRow | undefined> {
  const [row] = await db
    .select()
    .from(refunds)
    .where(
      and(
        eq(refunds.tradeId, tradeId),
        eq(refunds.scope, 'FULL'),
        inArray(refunds.status, ['REQUESTED', 'PROCESSING', 'PROCESSED', 'NEEDS_REVIEW']),
      ),
    );
  return row;
}

export async function findRefundByProviderId(
  db: Reader,
  provider: RefundRow['provider'],
  providerRefundId: string,
): Promise<RefundRow | undefined> {
  const [row] = await db
    .select()
    .from(refunds)
    .where(and(eq(refunds.provider, provider), eq(refunds.providerRefundId, providerRefundId)));
  return row;
}

/**
 * In-flight refunds against a charge that the provider has not named yet: what a `refund.*` webhook
 * can be matched to when the initiate call's answer was lost. Matched by either of the charge's
 * references, because Paystack's refund events carry the transaction's reference. Only the event's own
 * provider's refunds: another provider's reference space is not this one's.
 */
export async function unnamedRefundsForCharge(
  db: Reader,
  provider: RefundRow['provider'],
  chargeReference: string,
): Promise<RefundRow[]> {
  return db
    .select({ refund: refunds })
    .from(refunds)
    .innerJoin(paymentAttempts, eq(paymentAttempts.id, refunds.paymentAttemptId))
    .where(
      and(
        eq(refunds.provider, provider),
        eq(refunds.status, 'PROCESSING'),
        isNull(refunds.providerRefundId),
        or(
          eq(refunds.chargeReference, chargeReference),
          eq(paymentAttempts.reference, chargeReference),
          eq(paymentAttempts.providerReference, chargeReference),
        ),
      ),
    )
    .then((rows) => rows.map((row) => row.refund));
}

export async function listTradeRefunds(db: Reader, tradeId: string): Promise<RefundRow[]> {
  return db
    .select()
    .from(refunds)
    .where(eq(refunds.tradeId, tradeId))
    .orderBy(desc(refunds.requestedAt), desc(refunds.id));
}

/** A refund row with `requested_at` as Postgres renders it, to the microsecond: the cursor's key. */
export interface BuyerRefundRow {
  refund: RefundRow;
  requestedAtExact: string;
}

/**
 * A buyer's refunds, newest first, `limit + 1` rows from the cursor for `cursorPage`. The cursor is the
 * timestamp's own text, never a JavaScript Date: a Date keeps milliseconds, and a keyset that rounds
 * skips or repeats rows written within one millisecond of each other.
 */
export async function listBuyerRefunds(
  db: Reader,
  buyerUserId: string,
  limit: number,
  cursor?: { requestedAt: string; id: string },
): Promise<BuyerRefundRow[]> {
  const at = cursor ? sql`${cursor.requestedAt}::timestamptz` : undefined;
  return db
    .select({ refund: refunds, requestedAtExact: sql<string>`${refunds.requestedAt}::text` })
    .from(refunds)
    .where(
      and(
        eq(refunds.buyerUserId, buyerUserId),
        cursor && at
          ? or(
              sql`${refunds.requestedAt} < ${at}`,
              and(sql`${refunds.requestedAt} = ${at}`, lt(refunds.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(refunds.requestedAt), desc(refunds.id))
    .limit(limit + 1);
}

/** In-flight refunds untouched since `before`, oldest first: what the backstop sweep re-drives. */
export async function staleInFlightRefunds(
  db: Reader,
  statuses: readonly RefundStatus[],
  before: Date,
  limit: number,
): Promise<RefundRow[]> {
  return db
    .select()
    .from(refunds)
    .where(and(inArray(refunds.status, [...statuses]), lt(refunds.updatedAt, before)))
    .orderBy(refunds.updatedAt)
    .limit(limit);
}
