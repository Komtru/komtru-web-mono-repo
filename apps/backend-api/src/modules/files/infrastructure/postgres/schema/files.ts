// M20 §3.4-§3.6: the file record, the case-scoped grants that back PRIVATE_CASE, and the access log.
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { storageAccounts } from './accounts.js';
import { files } from './columns.js';
import { fileCategory, fileStatus, fileUploadState, fileVisibility } from './enums.js';

export const fileRecords = files.table(
  'file_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Soft reference to identity.users(id): cross-schema references are plain uuid (design §4.2). */
    uploaderUserId: uuid('uploader_user_id').notNull(),
    /** Provenance, derived from the category. A free-text field the client fills in is a suggestion. */
    owningModule: text('owning_module').notNull(),
    category: fileCategory('category').notNull(),
    visibility: fileVisibility('visibility').notNull(),
    /** D7: recorded once at upload time and never re-derived. */
    storageAccountId: uuid('storage_account_id')
      .notNull()
      .references(() => storageAccounts.id),
    /** D3: an opaque uuid-derived Cloudinary public_id, never sequential, never user-identifying. */
    storageObjectId: text('storage_object_id').notNull(),
    contentType: text('content_type').notNull(),
    /** Zero until the bytes land; the finalize job writes what Cloudinary actually received. */
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    uploadState: fileUploadState('upload_state').notNull().default('PENDING'),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    status: fileStatus('status').notNull().default('ACTIVE'),
    /**
     * Camera-capture metadata. There is deliberately NO column for a client-supplied capture time:
     * this is written from the database clock the moment the server is first told the bytes landed,
     * which is the only timestamp this module can vouch for. A park agent's device clock is not
     * evidence, and a custody photo stamped in the future is worse than one stamped a minute late.
     */
    captureReceivedAt: timestamp('capture_received_at', { withTimezone: true }),
    /** Soft reference to park.park_hubs(id) (T-091). Resolved server-side, never sent by a client. */
    captureHubId: uuid('capture_hub_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    tombstonedAt: timestamp('tombstoned_at', { withTimezone: true }),
    tombstonedReason: text('tombstoned_reason'),
  },
  (table) => [
    // Only unique per account: each of the five Cloudinary accounts has its own id namespace.
    uniqueIndex('file_records_account_object_unique').on(table.storageAccountId, table.storageObjectId),
    index('file_records_uploader_idx').on(table.uploaderUserId),
    index('file_records_category_idx').on(table.category),
    index('file_records_storage_account_idx').on(table.storageAccountId),
    // The abandoned-ticket sweep's only query. Partial, so it stays the size of the backlog rather
    // than of every file ever uploaded.
    index('file_records_pending_idx')
      .on(table.createdAt)
      .where(sql`${table.uploadState} IN ('PENDING', 'RECONCILING')`),
    // A hub id on a listing photo would be a custody claim about a file nobody took custody of.
    check(
      'file_records_capture_hub_category',
      sql`${table.captureHubId} IS NULL OR ${table.category} IN ('CUSTODY_EVIDENCE', 'PROOF_OF_DELIVERY')`,
    ),
    // D4: the row stays resolvable to "this existed and was removed for reason X", never to nothing.
    check(
      'file_records_tombstone_reason',
      sql`${table.status} <> 'TOMBSTONED' OR ${table.tombstonedReason} IS NOT NULL`,
    ),
  ],
);

export const fileAccessGrants = files.table(
  'file_access_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => fileRecords.id, { onDelete: 'cascade' }),
    /** Either this… */
    granteeUserId: uuid('grantee_user_id'),
    /** …or this (e.g. `DISPUTE_REVIEWER`), never both. */
    granteeRole: text('grantee_role'),
    grantedReason: text('granted_reason').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'file_access_grants_one_grantee_type',
      sql`num_nonnulls(${table.granteeUserId}, ${table.granteeRole}) = 1`,
    ),
    index('file_access_grants_file_idx')
      .on(table.fileId)
      .where(sql`${table.revokedAt} IS NULL`),
    // Makes a re-grant idempotent rather than a duplicate row: `dispute.opened` is at-least-once by
    // contract, so the same grant WILL be requested twice.
    uniqueIndex('file_access_grants_live_user_uidx')
      .on(table.fileId, table.granteeUserId)
      .where(sql`${table.revokedAt} IS NULL AND ${table.granteeUserId} IS NOT NULL`),
    uniqueIndex('file_access_grants_live_role_uidx')
      .on(table.fileId, table.granteeRole)
      .where(sql`${table.revokedAt} IS NULL AND ${table.granteeRole} IS NOT NULL`),
  ],
);

/**
 * Append-only (migration 0028). Every access decision for an audited category, refusals included —
 * a pattern of refused reads against KYC documents is exactly what an investigation looks for, and a
 * log that records only successes cannot show it.
 */
export const fileAccessLog = files.table(
  'file_access_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => fileRecords.id, { onDelete: 'cascade' }),
    accessedByUserId: uuid('accessed_by_user_id'),
    accessedByAdminId: uuid('accessed_by_admin_id'),
    accessGranted: boolean('access_granted').notNull(),
    /** The `AccessDenial` the decision returned, so the log says why and not only that. */
    deniedReason: text('denied_reason'),
  },
  (table) => [index('file_access_log_file_idx').on(table.fileId, table.occurredAt.desc().nullsFirst())],
);

export type FileRecord = typeof fileRecords.$inferSelect;
export type FileAccessGrant = typeof fileAccessGrants.$inferSelect;
export type FileAccessLogRow = typeof fileAccessLog.$inferSelect;
