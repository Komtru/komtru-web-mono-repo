// Reads and writes for payment attempts and the webhook log. No rule lives here: what may move
// where is `domain/funding.ts`, and the database's guard trigger (migration 0040) refuses the rest.
import { and, desc, eq, gte, inArray, isNull, lt, notLike, or, sql } from 'drizzle-orm';
import type { Db } from '../../../../db/index.js';
import type { Tx } from '../../../../platform/events/publish.js';
import type { PaymentProvider } from '../../domain/accounts.js';
import {
  paymentAttempts,
  paymentProviderWebhooks,
  type PaymentAttemptRow,
  type PaymentProviderWebhookRow,
} from './schema/payments.js';

type Reader = Db | Tx;

export type NewPaymentAttempt = typeof paymentAttempts.$inferInsert;
export type PaymentAttemptChange = Partial<
  Pick<
    PaymentAttemptRow,
    | 'status'
    | 'providerReference'
    | 'lastProviderStatus'
    | 'lastVerifiedAt'
    | 'verifiedAmountMinor'
    | 'verifiedCurrency'
    | 'journalEntryId'
    | 'failureReason'
    | 'pendingAt'
    | 'confirmedAt'
    | 'closedAt'
    | 'providerSeenAt'
    | 'lastVerifyError'
    | 'lastVerifyErrorAt'
    | 'reviewPublishedAt'
  >
>;

export async function insertPaymentAttempt(tx: Tx, values: NewPaymentAttempt): Promise<PaymentAttemptRow> {
  const [row] = await tx.insert(paymentAttempts).values(values).returning();
  if (!row) throw new Error('ledger: payment attempt insert returned no row');
  return row;
}

export async function findOpenAttempt(db: Reader, tradeId: string): Promise<PaymentAttemptRow | undefined> {
  const [row] = await db
    .select()
    .from(paymentAttempts)
    .where(
      and(eq(paymentAttempts.tradeId, tradeId), inArray(paymentAttempts.status, ['INITIATED', 'PENDING'])),
    );
  return row;
}

/**
 * The trade's open attempt, locked until the caller's transaction ends. Under READ COMMITTED a row a
 * concurrent settle has just closed is re-checked against the status filter after the lock is
 * granted, so a caller that waited behind a settle sees no open attempt rather than a stale one.
 */
export async function lockOpenAttempt(tx: Tx, tradeId: string): Promise<PaymentAttemptRow | undefined> {
  const [row] = await tx
    .select()
    .from(paymentAttempts)
    .where(
      and(eq(paymentAttempts.tradeId, tradeId), inArray(paymentAttempts.status, ['INITIATED', 'PENDING'])),
    )
    .for('update');
  return row;
}

/** How many checkouts the trade has had, and when the newest began. */
export async function attemptHistory(
  db: Reader,
  tradeId: string,
): Promise<{ count: number; latestInitiatedAt: Date | null }> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      latest: sql<string | null>`max(${paymentAttempts.initiatedAt})`,
    })
    .from(paymentAttempts)
    .where(eq(paymentAttempts.tradeId, tradeId));
  return { count: row?.count ?? 0, latestInitiatedAt: row?.latest ? new Date(row.latest) : null };
}

export async function findSucceededAttempt(
  db: Reader,
  tradeId: string,
): Promise<PaymentAttemptRow | undefined> {
  const [row] = await db
    .select()
    .from(paymentAttempts)
    .where(and(eq(paymentAttempts.tradeId, tradeId), eq(paymentAttempts.status, 'SUCCEEDED')));
  return row;
}

/** The attempt a buyer is looking at: the success if there is one, else the newest. */
export async function findCurrentAttempt(
  db: Reader,
  tradeId: string,
): Promise<PaymentAttemptRow | undefined> {
  const succeeded = await findSucceededAttempt(db, tradeId);
  if (succeeded) return succeeded;
  const [row] = await db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.tradeId, tradeId))
    .orderBy(desc(paymentAttempts.initiatedAt), desc(paymentAttempts.id))
    .limit(1);
  return row;
}

export async function findAttemptByReference(
  db: Reader,
  reference: string,
): Promise<PaymentAttemptRow | undefined> {
  const [row] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.reference, reference));
  return row;
}

/** The attempt, locked until the caller's transaction ends: what serialises two verifies of one charge. */
export async function lockAttemptByReference(
  tx: Tx,
  reference: string,
): Promise<PaymentAttemptRow | undefined> {
  const [row] = await tx
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.reference, reference))
    .for('update');
  return row;
}

export async function updatePaymentAttempt(
  tx: Tx,
  id: string,
  change: PaymentAttemptChange,
): Promise<PaymentAttemptRow> {
  const [row] = await tx.update(paymentAttempts).set(change).where(eq(paymentAttempts.id, id)).returning();
  if (!row) throw new Error(`ledger: payment attempt ${id} vanished during an update`);
  return row;
}

export interface RecordedDelivery {
  id: bigint;
  /** False when this delivery replayed one already on file. */
  inserted: boolean;
  processed: boolean;
}

/**
 * Inserts a delivery, or counts a replay of one. `xmax = 0` is true only for a row this statement
 * inserted, which is how one round trip tells the two apart.
 */
export async function recordDelivery(
  db: Db,
  delivery: { provider: PaymentProvider; providerEventId: string; eventType: string; payload: unknown },
): Promise<RecordedDelivery> {
  const [row] = await db
    .insert(paymentProviderWebhooks)
    .values({ ...delivery, signatureValid: true })
    .onConflictDoUpdate({
      target: [paymentProviderWebhooks.provider, paymentProviderWebhooks.providerEventId],
      set: { duplicateCount: sql`${paymentProviderWebhooks.duplicateCount} + 1` },
    })
    .returning({
      id: paymentProviderWebhooks.id,
      inserted: sql<boolean>`(xmax = 0)`,
      processedAt: paymentProviderWebhooks.processedAt,
    });
  if (!row) throw new Error('ledger: webhook insert returned no row');
  return { id: row.id, inserted: row.inserted, processed: row.processedAt !== null };
}

export async function findDelivery(db: Reader, id: bigint): Promise<PaymentProviderWebhookRow | undefined> {
  const [row] = await db.select().from(paymentProviderWebhooks).where(eq(paymentProviderWebhooks.id, id));
  return row;
}

/** Marks a delivery processed, once. A second call is a no-op rather than a trigger error. */
export async function markDeliveryProcessed(
  db: Reader,
  id: bigint,
  processingError: string | null = null,
): Promise<void> {
  await db
    .update(paymentProviderWebhooks)
    .set({ processedAt: new Date(), processingError })
    .where(and(eq(paymentProviderWebhooks.id, id), isNull(paymentProviderWebhooks.processedAt)));
}

/** The processing_error prefix the sweep leaves on a delivery it has given up re-queuing. */
export const EXHAUSTED_PREFIX = 'exhausted:';

/**
 * Deliveries stored but never processed, received between `receivedAfter` and `before`, re-queued
 * fewer than `maxSweeps` times and not given up on: what the sweep re-enqueues. Each one returned is
 * counted, in the same statement, so the bound holds however often the sweep runs.
 */
export async function claimStaleDeliveries(
  db: Db,
  window: { before: Date; receivedAfter: Date; maxSweeps: number; limit: number },
): Promise<bigint[]> {
  const t = paymentProviderWebhooks;
  const candidates = db
    .select({ id: t.id })
    .from(t)
    .where(
      and(
        isNull(t.processedAt),
        lt(t.receivedAt, window.before),
        gte(t.receivedAt, window.receivedAfter),
        lt(t.sweepCount, window.maxSweeps),
        or(isNull(t.processingError), notLike(t.processingError, `${EXHAUSTED_PREFIX}%`)),
      ),
    )
    .orderBy(t.receivedAt)
    .limit(window.limit);
  const rows = await db
    .update(t)
    .set({ sweepCount: sql`${t.sweepCount} + 1` })
    .where(inArray(t.id, candidates))
    .returning({ id: t.id });
  return rows.map((row) => row.id);
}

/**
 * Marks the deliveries the sweep will not try again — too old, or re-queued too often — so they stop
 * coming back and an operator can find them. They stay unprocessed: a Paystack retry of the same
 * event still queues them, and a run that then succeeds clears the mark.
 */
export async function markExhaustedDeliveries(
  db: Db,
  window: { receivedAfter: Date; maxSweeps: number },
): Promise<number> {
  const t = paymentProviderWebhooks;
  const rows = await db
    .update(t)
    .set({
      processingError: `${EXHAUSTED_PREFIX} not processed after ${String(window.maxSweeps)} sweeps or a day`,
    })
    .where(
      and(
        isNull(t.processedAt),
        or(isNull(t.processingError), notLike(t.processingError, `${EXHAUSTED_PREFIX}%`)),
        or(lt(t.receivedAt, window.receivedAfter), gte(t.sweepCount, window.maxSweeps)),
      ),
    )
    .returning({ id: t.id });
  return rows.length;
}
