// Cannibalized from kumtru/backend-apis/src/modules/files/domain/pools.ts (T-001). Adapted: types
// come from this module's own schema rather than a global `@db/schema`; CUSTODY_EVIDENCE is added to
// every table here; `contentTypeForFormat` and `carriesCaptureMetadata` are new, for the finalize
// job's type reconciliation and the capture-metadata rule respectively.
import type { FileCategory, StoragePool } from '../infrastructure/postgres/schema/enums.js';

/**
 * Category → pool (M20 §4).
 *
 * A fixed application-code constant, deliberately NOT a configurable table. Same stance as M9 D2: a
 * purely structural fact belongs in code, not in a row someone could edit at 2am and misroute KYC
 * documents into the chat account.
 *
 * Adding a `file_category` value later means adding one line here — never a migration, never a
 * `storage_accounts` change.
 */
export const POOL_BY_CATEGORY: Readonly<Record<FileCategory, StoragePool>> = Object.freeze({
  PROFILE_PHOTO: 'PROFILE',
  CHAT_ATTACHMENT: 'CHAT_ATTACHMENT',

  // Everything trade-related shares the rotated three-account pool (D5). Custody photos included:
  // design §7.2 puts `park_custody_events.photo_file_id` in the trade-asset pool by name.
  KYC_DOCUMENT: 'TRADE_ASSET',
  DISPUTE_EVIDENCE: 'TRADE_ASSET',
  CUSTODY_EVIDENCE: 'TRADE_ASSET',
  PROOF_OF_DELIVERY: 'TRADE_ASSET',
  LISTING_IMAGE: 'TRADE_ASSET',
  TICKET_ATTACHMENT: 'TRADE_ASSET',
  OTHER: 'TRADE_ASSET',
});

export const poolForCategory = (category: FileCategory): StoragePool => POOL_BY_CATEGORY[category];

/** D5: the single-account pools never rotate, so they never need a cursor. */
export const isRotatingPool = (pool: StoragePool): boolean => pool === 'TRADE_ASSET';

/**
 * Categories whose every access decision — grant AND refusal — is written to `file_access_log`.
 *
 * Three, not nine. Logging every listing-image view would bury the reads the log exists for under
 * three orders of magnitude of noise, and a compliance log nobody can read is not a control.
 * `CUSTODY_EVIDENCE` joins the spec's two because it is the evidence a parcel was intact when it
 * changed hands, which is what a custody dispute turns on.
 */
export const AUDITED_CATEGORIES: readonly FileCategory[] = Object.freeze([
  'KYC_DOCUMENT',
  'DISPUTE_EVIDENCE',
  'CUSTODY_EVIDENCE',
]);

export const isAuditedCategory = (category: FileCategory): boolean => AUDITED_CATEGORIES.includes(category);

/**
 * Categories a camera produces, and so the only ones that may carry a hub id.
 *
 * Mirrors the `file_records_capture_hub_category` check: the database is the enforcement, this is the
 * same fact where the application can act on it before the insert.
 */
export const CAPTURE_CATEGORIES: readonly FileCategory[] = Object.freeze([
  'CUSTODY_EVIDENCE',
  'PROOF_OF_DELIVERY',
]);

export const carriesCaptureMetadata = (category: FileCategory): boolean =>
  CAPTURE_CATEGORIES.includes(category);

/**
 * What a category is allowed to contain.
 *
 * Enforced when the ticket is issued and re-checked at finalize against what Cloudinary actually
 * received, because the client picks the content type on the first call and can lie about it. A KYC
 * "document" that is really an HTML file is a stored-XSS vector the moment anything renders it inline.
 */
export const ALLOWED_CONTENT_TYPES: Readonly<Record<FileCategory, readonly string[]>> = Object.freeze({
  PROFILE_PHOTO: Object.freeze(['image/jpeg', 'image/png', 'image/webp']),
  LISTING_IMAGE: Object.freeze(['image/jpeg', 'image/png', 'image/webp']),
  PROOF_OF_DELIVERY: Object.freeze(['image/jpeg', 'image/png', 'image/webp']),
  /** A hub agent's camera, and nothing else: a PDF is not a photograph of a seal. */
  CUSTODY_EVIDENCE: Object.freeze(['image/jpeg', 'image/png', 'image/webp']),
  CHAT_ATTACHMENT: Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  KYC_DOCUMENT: Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  DISPUTE_EVIDENCE: Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  TICKET_ATTACHMENT: Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  OTHER: Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
});

export const isAllowedContentType = (category: FileCategory, contentType: string): boolean =>
  ALLOWED_CONTENT_TYPES[category].includes(contentType.toLowerCase());

/**
 * MIME type → Cloudinary format name.
 *
 * Cloudinary's `allowed_formats` takes its own short names, not MIME types — `jpg`, never
 * `image/jpeg`. Passing a MIME type produces an upload refused for a reason the client cannot act on.
 */
const CLOUDINARY_FORMAT: Readonly<Record<string, string>> = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
});

/**
 * The inverse, for finalize.
 *
 * Cloudinary reports what it actually received, and that — not what the client declared when it asked
 * for the ticket — is what the row must end up holding. `jpeg` and `jpg` both appear in the wild.
 */
const CONTENT_TYPE_BY_FORMAT: Readonly<Record<string, string>> = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
});

export const contentTypeForFormat = (format: string): string | undefined =>
  CONTENT_TYPE_BY_FORMAT[format.toLowerCase()];

/**
 * The formats Cloudinary will accept for a category, for the signed upload's `allowed_formats`.
 *
 * This is the ONLY enforcement that happens before the bytes are stored, which is what makes it worth
 * having in addition to the content-type check: a file refused at the door never occupies the
 * account's quota and never becomes something a later reader has to be careful with.
 */
export const allowedFormatsFor = (category: FileCategory): string[] => [
  ...new Set(
    ALLOWED_CONTENT_TYPES[category]
      .map((contentType) => CLOUDINARY_FORMAT[contentType])
      .filter((format): format is string => format !== undefined),
  ),
];

/**
 * Cloudinary's `resource_type` segment for a content type.
 *
 * A PDF is `image` to Cloudinary, not `raw` — it renders and transforms them. Getting this wrong does
 * not fail loudly; it uploads to a URL namespace the delivery signature will not match.
 */
export const resourceTypeFor = (contentType: string): 'image' | 'raw' => {
  const lower = contentType.toLowerCase();
  return lower.startsWith('image/') || lower === 'application/pdf' ? 'image' : 'raw';
};
