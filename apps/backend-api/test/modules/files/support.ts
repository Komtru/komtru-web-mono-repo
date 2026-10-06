// Shared helpers for the files module's integration tests.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';

type Queryable = Pick<pg.Pool, 'query'>;

/** The SQLSTATE of a rejected query, so a test asserts which rule fired rather than that one did. */
export const sqlState = async (query: Promise<unknown>): Promise<string> => {
  try {
    await query;
  } catch (error) {
    return (error as pg.DatabaseError).code ?? 'no code';
  }
  return 'no error';
};

/** The constraint a rejected query violated, for the rules that share a SQLSTATE. */
export const constraintName = async (query: Promise<unknown>): Promise<string> => {
  try {
    await query;
  } catch (error) {
    return (error as pg.DatabaseError).constraint ?? 'no constraint';
  }
  return 'no error';
};

/**
 * The labels of an enum in the `files` schema, in sort order.
 *
 * Scoped to this module's schema, like identity's, trades' and ledger's equivalents. The earlier
 * version of this test imported ledger's, which pins `nspname = 'ledger'` and so returned an empty
 * array for every files enum — a test that could only ever fail, and did, while the schema it was
 * accusing was correct all along. Reaching into another module's test support is what made that
 * possible, so this one lives here.
 */
export const enumLabels = async (owner: Queryable, name: string): Promise<string[]> => {
  const { rows } = await owner.query<{ label: string }>(
    `SELECT e.enumlabel AS label
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'files' AND t.typname = $1
      ORDER BY e.enumsortorder`,
    [name],
  );
  return rows.map((row) => row.label);
};

export interface SeedAccount {
  pool?: 'PROFILE' | 'CHAT_ATTACHMENT' | 'TRADE_ASSET';
  label?: string;
  cloudName?: string;
  prefix?: string;
  status?: 'ACTIVE' | 'NEAR_QUOTA' | 'DISABLED';
  rotationOrder?: number | null;
}

/** Inserts a storage_accounts row directly, bypassing the service, and returns its id. */
export const insertStorageAccount = async (db: Queryable, input: SeedAccount = {}): Promise<string> => {
  const label = input.label ?? `acct-${randomUUID().slice(0, 8)}`;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO files.storage_accounts (pool, label, cloud_name, credential_env_prefix, status, rotation_order)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      input.pool ?? 'TRADE_ASSET',
      label,
      input.cloudName ?? `cloud-${label}`,
      input.prefix ?? `CLOUDINARY_${label.toUpperCase().replace(/-/g, '_')}`,
      input.status ?? 'ACTIVE',
      input.rotationOrder === undefined ? 1 : input.rotationOrder,
    ],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('insertStorageAccount: no row returned');
  return id;
};

export interface SeedFile {
  accountId: string;
  uploaderUserId?: string;
  category?: string;
  visibility?: string;
  objectId?: string;
  contentType?: string;
  captureHubId?: string | null;
}

/** Inserts a file_records row directly and returns its id. */
export const insertFileRecord = async (db: Queryable, input: SeedFile): Promise<string> => {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO files.file_records
       (uploader_user_id, owning_module, category, visibility, storage_account_id,
        storage_object_id, content_type, capture_hub_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      input.uploaderUserId ?? randomUUID(),
      'platform',
      input.category ?? 'OTHER',
      input.visibility ?? 'PRIVATE_OWNER',
      input.accountId,
      input.objectId ?? randomUUID().replace(/-/g, ''),
      input.contentType ?? 'image/jpeg',
      input.captureHubId ?? null,
    ],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('insertFileRecord: no row returned');
  return id;
};
