// D4's second half: the row is tombstoned first, in the caller's transaction, and the bytes are
// destroyed here. Doing it the other way round would leave an ACTIVE record pointing at bytes that
// are gone — a dangling reference wearing a live row's clothes.
import { UnrecoverableError } from 'bullmq';
import { resourceTypeFor } from '../domain/pools.js';
import type { DestroyAssetJob } from '../domain/queues.js';
import type { FileJobDeps } from './deps.js';

export async function runDestroyAsset(
  deps: FileJobDeps,
  data: DestroyAssetJob,
): Promise<{ destroyed: boolean }> {
  const record = await deps.store.findFile(data.fileId);

  if (!record) throw new UnrecoverableError(`files: no file record ${data.fileId}`);

  /**
   * The row's state is the authority, not the job's existence.
   *
   * BullMQ keeps a failed job for 30 days, so an operator retrying an old one — or a duplicate
   * enqueue — must not destroy bytes that are no longer marked for deletion. This is the only check
   * standing between a replayed job and an irreversible delete.
   */
  if (record.status !== 'TOMBSTONED') {
    throw new UnrecoverableError(`files: refusing to destroy ${data.fileId}, whose row is ${record.status}`);
  }

  const account = await deps.store.findAccountById(record.storageAccountId);
  if (!account) throw new UnrecoverableError(`files: ${data.fileId} references an unknown storage account`);

  // Never throws: a Cloudinary failure leaves an orphaned asset logged at error, which is strictly
  // better than a retry loop against a tombstone that has already landed.
  const destroyed = await deps.storage.destroyAsset({
    prefix: account.credentialEnvPrefix,
    publicId: record.storageObjectId,
    resourceType: resourceTypeFor(record.contentType),
  });

  return { destroyed };
}
