// Adapted from kumtru/backend-apis/src/modules/files/services/account.service.ts (T-001, same shape):
// every function takes its database handle and its configuration, and the quota events go through the
// transactional outbox rather than an in-process emitter.
//
// Storage-account selection and quota management (M20 §5, D6).
//
// The one invariant worth stating up front: the usage-sync job is the ONLY writer of
// `storage_accounts.status`. Application code never flips an account to DISABLED because an upload
// failed — a single transient 500 from Cloudinary would take an account out of rotation for a reason
// that had nothing to do with quota, and three in a row would take the whole pool down.
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { FilesConfig } from '../../../config/env.js';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import type { Logger } from '../../../platform/logger.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { PoolExhaustedError, StorageAccountUnconfiguredError } from '../domain/errors.js';
import { storageAccountDisabled, storageAccountNearQuota } from '../domain/events.js';
import { statusForCredits, type QuotaThresholds } from '../domain/quota.js';
import { nextInRotation } from '../domain/rotation.js';
import { isAccountConfigured } from '../infrastructure/credentials.js';
import type { Reader } from '../infrastructure/postgres/reader.js';
import {
  storageAccounts,
  storagePoolRotation,
  type StorageAccount,
  type StorageAccountStatus,
  type StoragePool,
} from '../infrastructure/postgres/schema/index.js';

// ---------------------------------------------------------------------------
// Selection (M20 §5)
// ---------------------------------------------------------------------------

/**
 * Picks the account a new upload should go to.
 *
 * For PROFILE and CHAT_ATTACHMENT this is a lookup — one account for life (D5), nothing to rotate.
 * For TRADE_ASSET it is the quota-aware round-robin of §5, and it advances the shared cursor as a side
 * effect, which is why it takes the caller's transaction rather than a `Db`: the cursor move and the
 * `file_records` insert must commit together or not at all.
 */
export const selectAccountForPool = async (
  tx: Tx,
  files: FilesConfig,
  pool: StoragePool,
): Promise<StorageAccount> => {
  if (pool !== 'TRADE_ASSET') {
    const candidates = await tx
      .select()
      .from(storageAccounts)
      .where(and(eq(storageAccounts.pool, pool), ne(storageAccounts.status, 'DISABLED')))
      .limit(2);

    const usable = candidates.find((account) => isAccountConfigured(files, account.credentialEnvPrefix));
    if (!usable) throw new PoolExhaustedError(pool);

    return usable;
  }

  return selectRotatedAccount(tx, files);
};

/**
 * §5 steps 1-5, in one transaction-safe pass.
 *
 * `FOR UPDATE` on the cursor row is what makes concurrent uploads actually rotate. Without it two
 * requests read the same `last_account_id`, both pick the same next account, and the pool degenerates
 * to "whichever account happens to be next" under exactly the concurrency that makes rotation matter.
 */
const selectRotatedAccount = async (tx: Tx, files: FilesConfig): Promise<StorageAccount> => {
  await tx
    .insert(storagePoolRotation)
    .values({ pool: 'TRADE_ASSET' })
    .onConflictDoNothing({ target: storagePoolRotation.pool });

  const locked = await tx.execute<{ last_account_id: string | null }>(
    sql`select "last_account_id" from "files"."storage_pool_rotation" where "pool" = 'TRADE_ASSET' for update`,
  );

  const lastAccountId = locked.rows[0]?.last_account_id ?? null;

  // Step 2, then step 3: ACTIVE first, and only if there are none, NEAR_QUOTA. A near-quota account
  // is deprioritised rather than excluded — better than failing an upload outright while an account
  // with 12% of its credits left sits idle.
  const active = await eligibleTradeAccounts(tx, files, ['ACTIVE']);
  const candidates = active.length > 0 ? active : await eligibleTradeAccounts(tx, files, ['NEAR_QUOTA']);

  // Step 4: fail closed. Never a silent fallback to an unpooled or insecure path (D6). The runbook
  // is one row in storage_accounts; nothing here should paper over its absence.
  if (candidates.length === 0) throw new PoolExhaustedError('TRADE_ASSET');

  const next = nextInRotation(candidates, lastAccountId);

  await tx
    .update(storagePoolRotation)
    .set({ lastAccountId: next.id, updatedAt: new Date() })
    .where(eq(storagePoolRotation.pool, 'TRADE_ASSET'));

  return next;
};

/** Candidates in rotation order, excluding accounts with no credentials in this environment. */
const eligibleTradeAccounts = async (
  tx: Tx,
  files: FilesConfig,
  statuses: StorageAccountStatus[],
): Promise<StorageAccount[]> => {
  const rows = await tx
    .select()
    .from(storageAccounts)
    .where(and(eq(storageAccounts.pool, 'TRADE_ASSET'), inArray(storageAccounts.status, statuses)))
    .orderBy(asc(storageAccounts.rotationOrder));

  return rows.filter((row) => isAccountConfigured(files, row.credentialEnvPrefix));
};

// ---------------------------------------------------------------------------
// Reads and registration
// ---------------------------------------------------------------------------

export const listAccounts = async (db: Reader): Promise<StorageAccount[]> =>
  db.select().from(storageAccounts).orderBy(asc(storageAccounts.pool), asc(storageAccounts.rotationOrder));

export const findAccountById = async (db: Reader, id: string): Promise<StorageAccount | undefined> => {
  const [found] = await db.select().from(storageAccounts).where(eq(storageAccounts.id, id)).limit(1);
  return found;
};

export interface RegisterAccountInput {
  pool: StoragePool;
  label: string;
  cloudName: string;
  credentialEnvPrefix: string;
  rotationOrder?: number | null;
}

/**
 * Registers a newly provisioned account (§5's runbook, D6).
 *
 * Refuses a prefix with no credentials in this environment. Accepting one would put a row into
 * rotation that `eligibleTradeAccounts` then silently filters out — the operator would see their new
 * account in the storage-account list, see uploads still failing, and have nothing connecting the two.
 */
export const registerAccount = async (
  db: Db,
  files: FilesConfig,
  input: RegisterAccountInput,
): Promise<StorageAccount> => {
  if (!isAccountConfigured(files, input.credentialEnvPrefix)) {
    throw new StorageAccountUnconfiguredError(input.credentialEnvPrefix);
  }

  const rotationOrder =
    input.pool === 'TRADE_ASSET' ? (input.rotationOrder ?? (await nextRotationOrder(db, input.pool))) : null;

  try {
    const [created] = await db
      .insert(storageAccounts)
      .values({
        pool: input.pool,
        label: input.label,
        cloudName: input.cloudName,
        credentialEnvPrefix: input.credentialEnvPrefix,
        rotationOrder,
      })
      .returning();

    if (!created) throw new Error('files: storage account insert returned no row');

    return created;
  } catch (error) {
    throw translateAccountConflict(error, input, rotationOrder);
  }
};

const nextRotationOrder = async (db: Reader, pool: StoragePool): Promise<number> => {
  const result = await db.execute<{ next: number }>(
    sql`select coalesce(max("rotation_order"), 0) + 1 as next
          from "files"."storage_accounts" where "pool" = ${pool}`,
  );

  return Number(result.rows[0]?.next ?? 1);
};

/** Drizzle wraps driver errors, so the pg SQLSTATE lives on `cause`, not on the message. */
const translateAccountConflict = (
  error: unknown,
  input: RegisterAccountInput,
  rotationOrder: number | null,
): unknown => {
  const cause = (error as { cause?: { code?: string; constraint?: string } } | undefined)?.cause;

  if (cause?.code !== '23505') return error;

  if (cause.constraint === 'storage_accounts_singleton_pool') {
    return new ApiError(
      409,
      'CONFLICT',
      'That pool already has an account',
      `The ${input.pool} pool is a single-account pool by design (M20 D5). Disable the existing ` +
        'account first if you are replacing it.',
    );
  }

  if (cause.constraint === 'storage_accounts_rotation_order_uidx') {
    return new ApiError(
      409,
      'CONFLICT',
      'That rotation slot is taken',
      `rotation_order ${String(rotationOrder)} is already used in the ${input.pool} pool.`,
    );
  }

  return new ApiError(
    409,
    'CONFLICT',
    'That storage account already exists',
    'A storage account with that label, cloud name or credential prefix is already registered.',
  );
};

// ---------------------------------------------------------------------------
// Usage (M20 §5)
// ---------------------------------------------------------------------------

export interface ApplyUsageInput {
  account: StorageAccount;
  usage: { storageUsedBytes: number; creditsUsedPct: number };
  thresholds: QuotaThresholds;
}

/**
 * Writes one account's polled usage and, if its status changed, publishes the ops alert.
 *
 * Both in one transaction: an alert that fires for a status the database never recorded would send
 * ops to look at an account that is still ACTIVE.
 */
export const applyUsage = async (db: Db, input: ApplyUsageInput): Promise<StorageAccountStatus> => {
  const next = statusForCredits(input.usage.creditsUsedPct, input.thresholds);

  await db.transaction(async (tx) => {
    await tx
      .update(storageAccounts)
      .set({
        storageUsedBytes: input.usage.storageUsedBytes,
        creditsUsedPct: input.usage.creditsUsedPct.toFixed(2),
        status: next,
        lastUsageSyncedAt: new Date(),
      })
      .where(eq(storageAccounts.id, input.account.id));

    // Only on a TRANSITION, so ops gets one alert per crossing rather than one an hour forever.
    // A recovery to ACTIVE is deliberately silent: nothing is wrong, and an "all clear" that nobody
    // acted on is noise in the one channel that must stay worth reading.
    if (next === input.account.status) return;

    const payload = {
      accountId: input.account.id,
      label: input.account.label,
      pool: input.account.pool,
      creditsUsedPct: input.usage.creditsUsedPct,
    };

    if (next === 'NEAR_QUOTA') {
      await publish(tx, storageAccountNearQuota, {
        payload,
        aggregateType: 'storage_account',
        aggregateId: input.account.id,
      });
      return;
    }

    if (next === 'DISABLED') {
      await publish(tx, storageAccountDisabled, {
        payload: { ...payload, reason: 'QUOTA_EXCEEDED' },
        aggregateType: 'storage_account',
        aggregateId: input.account.id,
      });
    }
  });

  return next;
};

// ---------------------------------------------------------------------------
// Seed (the ticket's first acceptance bullet)
// ---------------------------------------------------------------------------

/**
 * The default five (D5), keyed by credential prefix and in rotation order.
 *
 * Registered automatically so a fresh environment with credentials in its `.env` works without an
 * operator running the §5 runbook by hand. A SIXTH account is deliberately not expressible here — it
 * is provisioned through `POST /internal/storage-accounts`, which IS the runbook, and putting it in
 * code would mean a deploy for something D6 promises needs none.
 */
export const DEFAULT_ACCOUNTS: readonly {
  prefix: string;
  pool: StoragePool;
  label: string;
  rotationOrder: number | null;
}[] = Object.freeze([
  { prefix: 'CLOUDINARY_PROFILE', pool: 'PROFILE', label: 'profile', rotationOrder: null },
  { prefix: 'CLOUDINARY_CHAT', pool: 'CHAT_ATTACHMENT', label: 'chat', rotationOrder: null },
  { prefix: 'CLOUDINARY_TRADE_1', pool: 'TRADE_ASSET', label: 'trade-1', rotationOrder: 1 },
  { prefix: 'CLOUDINARY_TRADE_2', pool: 'TRADE_ASSET', label: 'trade-2', rotationOrder: 2 },
  { prefix: 'CLOUDINARY_TRADE_3', pool: 'TRADE_ASSET', label: 'trade-3', rotationOrder: 3 },
]);

/**
 * Reconciles `storage_accounts` against what this environment actually has credentials for.
 *
 * Idempotent, which is a requirement rather than a nicety: several API pods start at once, and a seed
 * that is not idempotent is a unique-violation crash loop on the first deploy that scales past one
 * replica. `ON CONFLICT DO NOTHING` does the work; the SELECT only keeps the log honest.
 */
export const seedStorageAccounts = async (db: Db, files: FilesConfig, logger: Logger): Promise<void> => {
  const configured = DEFAULT_ACCOUNTS.filter((account) => isAccountConfigured(files, account.prefix));
  const skipped = DEFAULT_ACCOUNTS.filter((account) => !isAccountConfigured(files, account.prefix));

  if (configured.length > 0) {
    const inserted = await db
      .insert(storageAccounts)
      .values(
        configured.map((account) => ({
          pool: account.pool,
          label: account.label,
          cloudName: files.accounts[account.prefix]?.cloudName ?? account.label,
          credentialEnvPrefix: account.prefix,
          rotationOrder: account.rotationOrder,
        })),
      )
      .onConflictDoNothing()
      .returning({ label: storageAccounts.label });

    if (inserted.length > 0) {
      logger.info({ registered: inserted.map((row) => row.label) }, 'files: storage accounts registered');
    }
  }

  // WARN rather than fail, the same posture notify takes for a missing provider credential: a staging
  // box whose secrets land a minute later should still boot. What must not happen is silence — an
  // upload into an unconfigured pool fails closed with a clear error (D6) rather than vanishing.
  if (skipped.length > 0) {
    logger.warn(
      { skipped: skipped.map((account) => account.prefix) },
      'files: storage accounts with no credentials in this environment — uploads to their pools will fail closed',
    );
  }
};
