// Reads and writes for payout accounts, preferences, payouts and holds (T-073). No rule lives here:
// what may move where is `domain/payouts.ts` and the services, and the guard triggers of migration
// 0048 refuse the rest.
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../../../../db/index.js';
import type { Tx } from '../../../../platform/events/publish.js';
import {
  payoutAccounts,
  payoutHolds,
  payoutPreferences,
  payouts,
  type PayoutAccountRow,
  type PayoutHoldRow,
  type PayoutMode,
  type PayoutRow,
  type PayoutStatus,
} from './schema/payouts.js';

type Reader = Db | Tx;

/**
 * Serialises everything that reads a user's available balance and then spends it: a payout, a hold,
 * a change of default account. Transaction-scoped, so it is released by COMMIT or ROLLBACK and is safe
 * behind PgBouncer's transaction pooling. Two withdrawals against one balance queue here; the second
 * reads the balance only after the first's debit has committed.
 */
export async function lockUserPayouts(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ledger:payable:${userId.toLowerCase()}`}))`);
}

// ---------------------------------------------------------------------------------------------
// Holds
// ---------------------------------------------------------------------------------------------

/** Holds in force now: not released, and not past their expiry. */
export async function activePayoutHolds(db: Reader, userId: string, now: Date): Promise<PayoutHoldRow[]> {
  return db
    .select()
    .from(payoutHolds)
    .where(
      and(
        eq(payoutHolds.userId, userId),
        isNull(payoutHolds.releasedAt),
        or(isNull(payoutHolds.expiresAt), gt(payoutHolds.expiresAt, now)),
      ),
    )
    .orderBy(payoutHolds.createdAt);
}

export async function insertPayoutHold(
  tx: Tx,
  values: typeof payoutHolds.$inferInsert,
): Promise<PayoutHoldRow> {
  const [row] = await tx.insert(payoutHolds).values(values).returning();
  if (!row) throw new Error('ledger: payout hold insert returned no row');
  return row;
}

export async function releasePayoutHoldRow(
  tx: Tx,
  holdId: string,
  releasedBy: string,
  now: Date,
): Promise<PayoutHoldRow | undefined> {
  const [row] = await tx
    .update(payoutHolds)
    .set({ releasedAt: now, releasedBy })
    .where(and(eq(payoutHolds.id, holdId), isNull(payoutHolds.releasedAt)))
    .returning();
  return row;
}

export async function findPayoutHold(db: Reader, holdId: string): Promise<PayoutHoldRow | undefined> {
  const [row] = await db.select().from(payoutHolds).where(eq(payoutHolds.id, holdId));
  return row;
}

// ---------------------------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------------------------

export type NewPayoutAccount = typeof payoutAccounts.$inferInsert;
export type PayoutAccountChange = Partial<
  Pick<
    PayoutAccountRow,
    | 'status'
    | 'accountName'
    | 'providerRecipientId'
    | 'nameMatchRef'
    | 'nameMatchResult'
    | 'isDefault'
    | 'failureReason'
    | 'verifiedAt'
    | 'disabledAt'
  >
>;

export async function insertPayoutAccount(tx: Reader, values: NewPayoutAccount): Promise<PayoutAccountRow> {
  const [row] = await tx.insert(payoutAccounts).values(values).returning();
  if (!row) throw new Error('ledger: payout account insert returned no row');
  return row;
}

export async function findPayoutAccount(db: Reader, id: string): Promise<PayoutAccountRow | undefined> {
  const [row] = await db.select().from(payoutAccounts).where(eq(payoutAccounts.id, id));
  return row;
}

export async function lockPayoutAccount(tx: Tx, id: string): Promise<PayoutAccountRow | undefined> {
  const [row] = await tx.select().from(payoutAccounts).where(eq(payoutAccounts.id, id)).for('update');
  return row;
}

/** The live record of one bank account for a user, if there is one. */
export async function findLiveAccount(
  db: Reader,
  input: { userId: string; bankCode: string; accountNumberHash: Buffer },
): Promise<PayoutAccountRow | undefined> {
  const [row] = await db
    .select()
    .from(payoutAccounts)
    .where(
      and(
        eq(payoutAccounts.userId, input.userId),
        eq(payoutAccounts.bankCode, input.bankCode),
        eq(payoutAccounts.accountNumberHash, input.accountNumberHash),
        inArray(payoutAccounts.status, ['PENDING_VERIFICATION', 'VERIFIED']),
      ),
    );
  return row;
}

/** Every account a user has added and not removed, newest first. Bounded by what one person adds. */
export async function listPayoutAccounts(db: Reader, userId: string): Promise<PayoutAccountRow[]> {
  return db
    .select()
    .from(payoutAccounts)
    .where(
      and(
        eq(payoutAccounts.userId, userId),
        inArray(payoutAccounts.status, ['PENDING_VERIFICATION', 'VERIFIED', 'FAILED']),
      ),
    )
    .orderBy(desc(payoutAccounts.createdAt), desc(payoutAccounts.id))
    .limit(50);
}

export async function findDefaultAccount(db: Reader, userId: string): Promise<PayoutAccountRow | undefined> {
  const [row] = await db
    .select()
    .from(payoutAccounts)
    .where(and(eq(payoutAccounts.userId, userId), eq(payoutAccounts.isDefault, true)));
  return row;
}

export async function updatePayoutAccount(
  tx: Tx,
  id: string,
  change: PayoutAccountChange,
): Promise<PayoutAccountRow> {
  const [row] = await tx.update(payoutAccounts).set(change).where(eq(payoutAccounts.id, id)).returning();
  if (!row) throw new Error(`ledger: payout account ${id} vanished during an update`);
  return row;
}

/** Accounts still waiting on a verify job, oldest first, for the backstop sweep. */
export async function stalePendingAccounts(
  db: Reader,
  before: Date,
  createdAfter: Date,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: payoutAccounts.id })
    .from(payoutAccounts)
    .where(
      and(
        eq(payoutAccounts.status, 'PENDING_VERIFICATION'),
        lt(payoutAccounts.updatedAt, before),
        gt(payoutAccounts.createdAt, createdAfter),
      ),
    )
    .orderBy(payoutAccounts.updatedAt)
    .limit(limit);
  return rows.map((row) => row.id);
}

// ---------------------------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------------------------

/** MANUAL when the user has never chosen. */
export async function findPayoutMode(db: Reader, userId: string): Promise<PayoutMode> {
  const [row] = await db
    .select({ mode: payoutPreferences.mode })
    .from(payoutPreferences)
    .where(eq(payoutPreferences.userId, userId));
  return row?.mode ?? 'MANUAL';
}

export async function upsertPayoutMode(tx: Tx, userId: string, mode: PayoutMode): Promise<void> {
  await tx
    .insert(payoutPreferences)
    .values({ userId, mode })
    .onConflictDoUpdate({ target: payoutPreferences.userId, set: { mode, updatedAt: sql`now()` } });
}

/** Users whose mode is one of these, in id order, a page at a time. */
export async function usersWithModes(
  db: Reader,
  modes: readonly PayoutMode[],
  after: string | null,
  limit: number,
): Promise<{ userId: string; mode: PayoutMode }[]> {
  if (!modes.length) return [];
  return db
    .select({ userId: payoutPreferences.userId, mode: payoutPreferences.mode })
    .from(payoutPreferences)
    .where(
      and(
        inArray(payoutPreferences.mode, [...modes]),
        after ? gt(payoutPreferences.userId, after) : undefined,
      ),
    )
    .orderBy(payoutPreferences.userId)
    .limit(limit);
}

// ---------------------------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------------------------

export type NewPayout = typeof payouts.$inferInsert;
export type PayoutChange = Partial<
  Pick<
    PayoutRow,
    | 'status'
    | 'providerTransferId'
    | 'lastProviderStatus'
    | 'lastCheckedAt'
    | 'failureReason'
    | 'settledJournalId'
    | 'reversedJournalId'
    | 'dispatchedAt'
    | 'completedAt'
    | 'failedAt'
  >
>;

export async function insertPayout(tx: Tx, values: NewPayout): Promise<PayoutRow> {
  const [row] = await tx.insert(payouts).values(values).returning();
  if (!row) throw new Error('ledger: payout insert returned no row');
  return row;
}

export async function findPayout(db: Reader, id: string): Promise<PayoutRow | undefined> {
  const [row] = await db.select().from(payouts).where(eq(payouts.id, id));
  return row;
}

/** The payout, locked until the caller's transaction ends: what serialises two resolutions of one. */
export async function lockPayout(tx: Tx, id: string): Promise<PayoutRow | undefined> {
  const [row] = await tx.select().from(payouts).where(eq(payouts.id, id)).for('update');
  return row;
}

export async function updatePayout(tx: Tx, id: string, change: PayoutChange): Promise<PayoutRow> {
  const [row] = await tx.update(payouts).set(change).where(eq(payouts.id, id)).returning();
  if (!row) throw new Error(`ledger: payout ${id} vanished during an update`);
  return row;
}

export async function findPayoutBySource(db: Reader, journalEntryId: string): Promise<PayoutRow | undefined> {
  const [row] = await db.select().from(payouts).where(eq(payouts.sourceJournalEntryId, journalEntryId));
  return row;
}

export async function findPayoutBySweepKey(db: Reader, key: string): Promise<PayoutRow | undefined> {
  const [row] = await db.select().from(payouts).where(eq(payouts.sweepKey, key));
  return row;
}

/** A user's payouts, newest first, `limit + 1` rows from the cursor for `cursorPage`. */
export async function listUserPayouts(
  db: Reader,
  userId: string,
  limit: number,
  cursor?: { requestedAt: Date; id: string },
): Promise<PayoutRow[]> {
  return db
    .select()
    .from(payouts)
    .where(
      and(
        eq(payouts.userId, userId),
        cursor
          ? or(
              lt(payouts.requestedAt, cursor.requestedAt),
              and(eq(payouts.requestedAt, cursor.requestedAt), lt(payouts.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(payouts.requestedAt), desc(payouts.id))
    .limit(limit + 1);
}

/** What is on its way to the bank and not settled: the sum of the user's in-flight transfers. */
export async function inFlightTotal(db: Reader, userId: string): Promise<bigint> {
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${payouts.amountMinor}), 0)` })
    .from(payouts)
    .where(and(eq(payouts.userId, userId), inArray(payouts.status, ['REQUESTED', 'PROCESSING'])));
  return BigInt(row?.total ?? '0');
}

export async function countInFlightToAccount(db: Reader, accountId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(payouts)
    .where(and(eq(payouts.payoutAccountId, accountId), inArray(payouts.status, ['REQUESTED', 'PROCESSING'])));
  return row?.n ?? 0;
}

/** In-flight payouts untouched since `before`, oldest first: what the backstop sweep re-drives. */
export async function staleInFlightPayouts(
  db: Reader,
  statuses: readonly PayoutStatus[],
  before: Date,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: payouts.id })
    .from(payouts)
    .where(and(inArray(payouts.status, [...statuses]), lt(payouts.updatedAt, before)))
    .orderBy(payouts.updatedAt)
    .limit(limit);
  return rows.map((row) => row.id);
}
