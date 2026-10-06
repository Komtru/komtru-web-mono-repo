// M20 §6's "confirms the upload actually landed, checked against Cloudinary's own response rather
// than trusting the client's word for it" — as a job, because the ticket requires the reconciliation
// to run off the request path and no request handler may reach a provider (design §4.4).
import { UnrecoverableError } from 'bullmq';
import { resourceTypeFor } from '../domain/pools.js';
import type { FinalizeUploadJob } from '../domain/queues.js';
import type { ReconcileOutcome } from '../services/file.service.js';
import type { FileJobDeps } from './deps.js';

/**
 * Asks Cloudinary what landed and hands the answer to the service.
 *
 * A missing asset THROWS rather than returning quietly. The client may still be uploading a 15MB
 * photo over a Nigerian mobile connection, and BullMQ's exponential backoff is exactly the right
 * wait; returning here would leave the row RECONCILING until the hourly sweep tombstoned it, so the
 * user would be told their document was never received when it was still in flight.
 */
export async function runFinalizeUpload(
  deps: FileJobDeps,
  data: FinalizeUploadJob,
): Promise<ReconcileOutcome> {
  const record = await deps.store.findFile(data.fileId);

  // Deterministic failures: retrying them five times only delays the dead-letter and its alert.
  if (!record) throw new UnrecoverableError(`files: no file record ${data.fileId}`);
  if (record.status === 'TOMBSTONED') {
    throw new UnrecoverableError(`files: ${data.fileId} was tombstoned before it could be reconciled`);
  }
  if (record.uploadState === 'READY') return { outcome: 'READY', record };

  const account = await deps.store.findAccountById(record.storageAccountId);
  if (!account) throw new UnrecoverableError(`files: ${data.fileId} references an unknown storage account`);

  const resource = await deps.storage.fetchResource({
    prefix: account.credentialEnvPrefix,
    publicId: record.storageObjectId,
    // The type the ticket was issued for: Cloudinary's namespaces are separate, and a PDF is an
    // `image` to Cloudinary, so looking in the wrong one reports "missing" for a file that is there.
    resourceType: resourceTypeFor(record.contentType),
  });

  if (!resource) {
    throw new Error(`files: no upload has landed for ${data.fileId} yet`);
  }

  const outcome = await deps.store.applyReconciliation({
    fileId: data.fileId,
    maxUploadBytes: deps.files.maxUploadBytes,
    resource,
  });

  if (outcome.outcome === 'REJECTED') {
    deps.logger.warn(
      { fileId: data.fileId, reason: outcome.reason },
      'files: upload refused at reconciliation',
    );
  }

  return outcome;
}
