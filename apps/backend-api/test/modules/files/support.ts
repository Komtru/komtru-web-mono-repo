// Shared helpers for the files module's integration tests.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';

type Queryable = Pick<pg.Pool, 'query'>;

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
