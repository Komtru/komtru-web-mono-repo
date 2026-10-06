// M20 §3.2-§3.3: the five Cloudinary accounts and the one rotation cursor the trade-asset pool shares.
//
// D7 is the reason this table exists at all: each account is a fully separate set of credentials with
// no shared namespace, so "which of the five holds these bytes" is a fact that must be recorded once
// at upload time and never re-derived.
import { sql } from 'drizzle-orm';
import { bigint, check, numeric, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { files } from './columns.js';
import { storageAccountStatus, storagePool } from './enums.js';

export const storageAccounts = files.table(
  'storage_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pool: storagePool('pool').notNull(),
    /** `profile` | `chat` | `trade-1` …; what an operator reads in the platform-health list. */
    label: text('label').notNull().unique(),
    cloudName: text('cloud_name').notNull().unique(),
    /** Resolves to `<prefix>_CLOUD_NAME`, `_API_KEY`, `_API_SECRET` in this environment's config. */
    credentialEnvPrefix: text('credential_env_prefix').notNull().unique(),
    status: storageAccountStatus('status').notNull().default('ACTIVE'),
    /** Only meaningful inside TRADE_ASSET; D5's two singleton pools have nothing to rotate. */
    rotationOrder: smallint('rotation_order'),
    storageUsedBytes: bigint('storage_used_bytes', { mode: 'number' }).notNull().default(0),
    creditsUsedPct: numeric('credits_used_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    lastUsageSyncedAt: timestamp('last_usage_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // D5 structurally rather than by convention: a second dedicated account can never split the
    // traffic of a pool that is single-account by design. `status <> 'DISABLED'` is what lets an
    // account be replaced — disable the old row first, then register the new one.
    uniqueIndex('storage_accounts_singleton_pool')
      .on(table.pool)
      .where(sql`${table.pool} IN ('PROFILE', 'CHAT_ATTACHMENT') AND ${table.status} <> 'DISABLED'`),
    // Two accounts claiming slot 2 makes rotation order depend on physical row order, which is the
    // one thing round-robin must not do.
    uniqueIndex('storage_accounts_rotation_order_uidx')
      .on(table.pool, table.rotationOrder)
      .where(sql`${table.rotationOrder} IS NOT NULL`),
    check('storage_accounts_credits_pct_range', sql`${table.creditsUsedPct} BETWEEN 0 AND 100`),
  ],
);

/**
 * The round-robin cursor (D6).
 *
 * In practice only ever holds a `TRADE_ASSET` row. It is a table rather than a column on
 * `storage_accounts` because the selection takes `FOR UPDATE` on it: one row to serialise on, so two
 * concurrent uploads cannot both read the same predecessor and pick the same account.
 */
export const storagePoolRotation = files.table('storage_pool_rotation', {
  pool: storagePool('pool').primaryKey(),
  lastAccountId: uuid('last_account_id').references(() => storageAccounts.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type StorageAccount = typeof storageAccounts.$inferSelect;
export type StoragePoolRotationRow = typeof storagePoolRotation.$inferSelect;
