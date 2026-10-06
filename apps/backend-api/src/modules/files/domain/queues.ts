// Queue and schedule names, and the payloads that travel on them.
//
// This file sits in `domain/` rather than in `jobs/` deliberately, and the placement is load-bearing:
// `komtru/provider-clients` forbids anything outside `jobs/` from importing a file in `jobs/` (it
// would be a second route to the provider client), but the finalize route and the tombstone route
// both have to enqueue. Putting the names and payload types here — pure data, no client, no I/O —
// lets http/ and services/ enqueue without crossing the boundary.
export const FILES_QUEUES = {
  /** Asks Cloudinary what actually landed, and reconciles the row (M20 §6). */
  FINALIZE: 'files.finalize-upload',
  /** Destroys the asset behind a tombstone (D4). */
  DESTROY: 'files.destroy-asset',
} as const;

export const FILES_SCHEDULES = {
  /** M20 §5's hourly usage poll: the only writer of storage_accounts.status. */
  SYNC_USAGE: 'files.sync-usage',
  /** Reclaims upload tickets that were issued and never used. */
  PURGE_ABANDONED: 'files.purge-abandoned',
} as const;

export type FilesQueueName = (typeof FILES_QUEUES)[keyof typeof FILES_QUEUES];

export interface FinalizeUploadJob {
  fileId: string;
}

export interface DestroyAssetJob {
  fileId: string;
}
