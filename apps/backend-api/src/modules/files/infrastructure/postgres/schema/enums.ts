// M20 §3.1. The category and visibility lists moved to @komtru/shared-types: they ARE a shared
// contract, whatever the original note here said. Four upload screens in web-app-ui choose a pair
// and post it, and because the lists lived only here nothing stopped all four choosing a pair the
// platform refuses — `OTHER` + `PRIVATE_CASE`, which can never be accepted. See `files.ts` there.
//
// Re-exported rather than redeclared, so the Postgres enum and the type the browser compiles
// against cannot drift: a value added in one place is in both or in neither.
import { FILE_CATEGORIES, FILE_VISIBILITIES } from '@komtru/shared-types';
import { files } from './columns.js';

export { FILE_CATEGORIES, FILE_VISIBILITIES };

/** D4: deletion is a tombstone, so a soft ref resolves to "this existed and was removed". */
export const FILE_STATUSES = ['ACTIVE', 'TOMBSTONED'] as const;

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
