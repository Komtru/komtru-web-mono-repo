// M20 §3: the rules this module relies on the database to keep. Each one of these is a guarantee the
// application code above it is written assuming — a singleton pool that cannot be split, an object id
// that is unique only within its own account, a grant that names exactly one subject, and an access
// log that can only grow. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../../../support/db-urls.js';
import { useTestDatabase } from '../../../../support/db.js';
import { constraintName, enumLabels, sqlState } from '../../../ledger/support.js';
import { insertFileRecord, insertStorageAccount } from '../../support.js';

describe.runIf(infraEnabled)('files schema', () => {
  const t = useTestDatabase();

  it('carries CUSTODY_EVIDENCE in file_category, for Park custody photos', async () => {
    expect(await enumLabels(t.owner(), 'file_category')).toContain('CUSTODY_EVIDENCE');
  });

  it('refuses a second live account in a singleton pool (D5)', async () => {
    await insertStorageAccount(t.app(), { pool: 'PROFILE', rotationOrder: null });
    expect(
      await constraintName(insertStorageAccount(t.app(), { pool: 'PROFILE', rotationOrder: null })),
    ).toBe('storage_accounts_singleton_pool');
  });

  it('allows a replacement once the account it replaces is DISABLED', async () => {
    await insertStorageAccount(t.app(), { pool: 'CHAT_ATTACHMENT', status: 'DISABLED', rotationOrder: null });
    await expect(
      insertStorageAccount(t.app(), { pool: 'CHAT_ATTACHMENT', rotationOrder: null }),
    ).resolves.toBeTypeOf('string');
  });

  it('refuses two trade accounts claiming the same rotation slot', async () => {
    await insertStorageAccount(t.app(), { rotationOrder: 2 });
    expect(await constraintName(insertStorageAccount(t.app(), { rotationOrder: 2 }))).toBe(
      'storage_accounts_rotation_order_uidx',
    );
  });

  it('lets the two singleton pools share a null rotation order', async () => {
    await insertStorageAccount(t.app(), { pool: 'PROFILE', rotationOrder: null });
    await expect(
      insertStorageAccount(t.app(), { pool: 'CHAT_ATTACHMENT', rotationOrder: null }),
    ).resolves.toBeTypeOf('string');
  });

  it('refuses a credits percentage outside 0-100', async () => {
    const id = await insertStorageAccount(t.app());
    expect(
      await constraintName(
        t.app().query('UPDATE files.storage_accounts SET credits_used_pct = 143 WHERE id = $1', [id]),
      ),
    ).toBe('storage_accounts_credits_pct_range');
  });

  it('scopes storage_object_id uniqueness to its own account (D7)', async () => {
    const [first, second] = [
      await insertStorageAccount(t.app()),
      await insertStorageAccount(t.app(), { rotationOrder: 2 }),
    ];
    const objectId = randomUUID().replace(/-/g, '');
    await insertFileRecord(t.app(), { accountId: first, objectId });
    // The same id under a different account is a different asset: each Cloudinary account has its
    // own independent id namespace.
    await expect(insertFileRecord(t.app(), { accountId: second, objectId })).resolves.toBeTypeOf('string');
    expect(await constraintName(insertFileRecord(t.app(), { accountId: first, objectId }))).toBe(
      'file_records_account_object_unique',
    );
  });

  it('keeps a hub id off a category that cannot have been captured at one', async () => {
    const accountId = await insertStorageAccount(t.app());
    expect(
      await constraintName(
        insertFileRecord(t.app(), {
          accountId,
          category: 'LISTING_IMAGE',
          visibility: 'PUBLIC',
          captureHubId: randomUUID(),
        }),
      ),
    ).toBe('file_records_capture_hub_category');
  });

  it('accepts a hub id on a custody photo', async () => {
    const accountId = await insertStorageAccount(t.app());
    await expect(
      insertFileRecord(t.app(), {
        accountId,
        category: 'CUSTODY_EVIDENCE',
        visibility: 'PRIVATE_CASE',
        captureHubId: randomUUID(),
      }),
    ).resolves.toBeTypeOf('string');
  });

  it('refuses a tombstone with no reason', async () => {
    const accountId = await insertStorageAccount(t.app());
    const fileId = await insertFileRecord(t.app(), { accountId });
    expect(
      await constraintName(
        t.app().query(`UPDATE files.file_records SET status = 'TOMBSTONED' WHERE id = $1`, [fileId]),
      ),
    ).toBe('file_records_tombstone_reason');
  });

  it('requires a grant to name exactly one subject', async () => {
    const accountId = await insertStorageAccount(t.app());
    const fileId = await insertFileRecord(t.app(), { accountId, visibility: 'PRIVATE_CASE' });
    const insert = (userId: string | null, role: string | null) =>
      t.app().query(
        `INSERT INTO files.file_access_grants (file_id, grantee_user_id, grantee_role, granted_reason)
           VALUES ($1, $2, $3, 'test')`,
        [fileId, userId, role],
      );
    expect(await constraintName(insert(randomUUID(), 'DISPUTE_REVIEWER'))).toBe(
      'file_access_grants_one_grantee_type',
    );
    expect(await constraintName(insert(null, null))).toBe('file_access_grants_one_grantee_type');
    await expect(insert(randomUUID(), null)).resolves.toBeTruthy();
  });

  it('lets file_access_log only grow', async () => {
    const accountId = await insertStorageAccount(t.app());
    const fileId = await insertFileRecord(t.app(), { accountId, category: 'KYC_DOCUMENT' });
    await t
      .app()
      .query(
        `INSERT INTO files.file_access_log (file_id, accessed_by_user_id, access_granted) VALUES ($1, $2, true)`,
        [fileId, randomUUID()],
      );
    // 42501 for the runtime role, which holds no UPDATE or DELETE grant at all.
    expect(await sqlState(t.app().query('UPDATE files.file_access_log SET access_granted = false'))).toBe(
      '42501',
    );
    expect(await sqlState(t.app().query('DELETE FROM files.file_access_log'))).toBe('42501');
    // KT001 for the owner: the trigger refuses it too, so this is evidence rather than a privilege.
    expect(await sqlState(t.owner().query('UPDATE files.file_access_log SET access_granted = false'))).toBe(
      'KT001',
    );
    expect(await sqlState(t.owner().query('DELETE FROM files.file_access_log'))).toBe('KT001');
  });
});
