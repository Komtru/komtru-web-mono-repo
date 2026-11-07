// Reads and writes for payment attempts and the webhook log. No rule lives here: what may move
// where is `domain/funding.ts`, and the database's guard trigger (migration 0040) refuses the rest.
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
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

/** Deliveries stored but never processed, older than `before`: what the sweep re-enqueues. */
export async function listStaleDeliveries(db: Reader, before: Date, limit: number): Promise<bigint[]> {
  const rows = await db
    .select({ id: paymentProviderWebhooks.id })
    .from(paymentProviderWebhooks)
    .where(and(isNull(paymentProviderWebhooks.processedAt), lt(paymentProviderWebhooks.receivedAt, before)))
    .orderBy(paymentProviderWebhooks.receivedAt)
    .limit(limit);
  return rows.map((row) => row.id);
}
