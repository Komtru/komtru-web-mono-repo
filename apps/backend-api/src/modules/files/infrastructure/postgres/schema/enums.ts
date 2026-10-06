// M20 §3.1, declared inline rather than built from @komtru/shared-types: nothing in this ticket puts
// a file category on the wire as a shared contract, and the two values below that the spec does not
// have are this build's.
import { files } from './columns.js';

/** D2: set explicitly by the uploading module, never inferred from context afterwards. */
export const FILE_VISIBILITIES = ['PUBLIC', 'PRIVATE_OWNER', 'PRIVATE_CASE', 'INTERNAL_ONLY'] as const;

/** D4: deletion is a tombstone, so a soft ref resolves to "this existed and was removed". */
export const FILE_STATUSES = ['ACTIVE', 'TOMBSTONED'] as const;

export const FILE_CATEGORIES = [
  'LISTING_IMAGE',
  'KYC_DOCUMENT',
  'DISPUTE_EVIDENCE',
  /**
   * T-040's addition: a Park hub agent's custody photo (design §7.2, `park_custody_events`). It sits
   * in the trade-asset pool like every other trade-related asset, and it is audited like KYC and
   * dispute evidence because it is the evidence a parcel was intact when it changed hands.
   */
  'CUSTODY_EVIDENCE',
  'PROOF_OF_DELIVERY',
  'TICKET_ATTACHMENT',
  'PROFILE_PHOTO',
  'CHAT_ATTACHMENT',
  'OTHER',
] as const;

/**
 * T-040's addition, forced by the ticket's "reconciles size and type via a job".
 *
 * The bytes go straight from the browser to Cloudinary, so "the client says it uploaded" and
 * "Cloudinary confirms it landed" are two different facts, and only the second one may serve bytes.
 * REJECTED is the oversize or wrong-type outcome, which is a tombstone with a reason.
 */
export const FILE_UPLOAD_STATES = ['PENDING', 'RECONCILING', 'READY', 'REJECTED'] as const;

export const STORAGE_POOLS = ['PROFILE', 'CHAT_ATTACHMENT', 'TRADE_ASSET'] as const;

export const STORAGE_ACCOUNT_STATUSES = ['ACTIVE', 'NEAR_QUOTA', 'DISABLED'] as const;

export const fileVisibility = files.enum('file_visibility', FILE_VISIBILITIES);
export const fileStatus = files.enum('file_status', FILE_STATUSES);
export const fileCategory = files.enum('file_category', FILE_CATEGORIES);
export const fileUploadState = files.enum('file_upload_state', FILE_UPLOAD_STATES);
export const storagePool = files.enum('storage_pool', STORAGE_POOLS);
export const storageAccountStatus = files.enum('storage_account_status', STORAGE_ACCOUNT_STATUSES);

export type FileVisibility = (typeof FILE_VISIBILITIES)[number];
export type FileStatus = (typeof FILE_STATUSES)[number];
export type FileCategory = (typeof FILE_CATEGORIES)[number];
export type FileUploadState = (typeof FILE_UPLOAD_STATES)[number];
export type StoragePool = (typeof STORAGE_POOLS)[number];
export type StorageAccountStatus = (typeof STORAGE_ACCOUNT_STATUSES)[number];
