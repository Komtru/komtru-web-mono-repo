// What a file is and who may see it — the one place the browser and the platform agree on it.
//
// These used to be declared only inside the backend, on the reasoning that no file category ever
// crossed the wire as a shared contract. That was wrong in practice: four upload screens in
// web-app-ui pick a category and a visibility and post them, and every one of them picked a pair
// the platform refuses. The page said "That file cannot be uploaded that way" and the combination
// could never have worked — `OTHER` files may not be `PRIVATE_CASE`, in any release, ever.
//
// So the pairing lives here and is a type, not a comment. `UploadTarget` only admits pairs the
// platform accepts, which means that class of bug now fails `tsc` instead of a production upload.

import { z } from 'zod';

export const FILE_VISIBILITIES = ['PUBLIC', 'PRIVATE_OWNER', 'PRIVATE_CASE', 'INTERNAL_ONLY'] as const;
export type FileVisibility = (typeof FILE_VISIBILITIES)[number];
export const fileVisibilitySchema = z.enum(FILE_VISIBILITIES);

export const FILE_CATEGORIES = [
  'LISTING_IMAGE',
  'KYC_DOCUMENT',
  'DISPUTE_EVIDENCE',
  'CUSTODY_EVIDENCE',
  'PROOF_OF_DELIVERY',
  'TICKET_ATTACHMENT',
  'PROFILE_PHOTO',
  'CHAT_ATTACHMENT',
  'OTHER',
] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];
export const fileCategorySchema = z.enum(FILE_CATEGORIES);

/**
 * Which visibilities each category may be stored under.
 *
 * The backend's `ALLOWED_VISIBILITY` is built from this, so there is one list rather than two that
 * agree until someone edits one of them.
 */
export const FILE_VISIBILITY_BY_CATEGORY = {
  /** Shown to counterparties on a party card, so public is the point. */
  PROFILE_PHOTO: ['PUBLIC'],
  /** A listing nobody can see the photos of is not a listing. */
  LISTING_IMAGE: ['PUBLIC'],
  /** Never anything but the uploader's own. This is the NIN/BVN-adjacent one. */
  KYC_DOCUMENT: ['PRIVATE_OWNER'],
  /** The multi-party case classes — buyer, seller, assigned reviewer, resolved through grants. */
  DISPUTE_EVIDENCE: ['PRIVATE_CASE'],
  PROOF_OF_DELIVERY: ['PRIVATE_CASE'],
  CUSTODY_EVIDENCE: ['PRIVATE_CASE'],
  TICKET_ATTACHMENT: ['PRIVATE_CASE'],
  CHAT_ATTACHMENT: ['PRIVATE_CASE'],
  /** The escape hatch stays narrow: owner-private, or staff-internal. */
  OTHER: ['PRIVATE_OWNER', 'INTERNAL_ONLY'],
} as const satisfies Record<FileCategory, readonly FileVisibility[]>;

/**
 * A category and a visibility the platform will actually accept together.
 *
 * Written as a union over the categories rather than two independent fields, so
 * `{ category: 'OTHER', visibility: 'PRIVATE_CASE' }` is a compile error at the call site instead
 * of a 403 on a page somebody is standing in front of.
 */
export type UploadTarget = {
  [C in FileCategory]: {
    readonly category: C;
    readonly visibility: (typeof FILE_VISIBILITY_BY_CATEGORY)[C][number];
  };
}[FileCategory];

/** True when the platform would accept this pair. The runtime half of `UploadTarget`. */
export const isAllowedUpload = (category: FileCategory, visibility: FileVisibility): boolean =>
  (FILE_VISIBILITY_BY_CATEGORY[category] as readonly FileVisibility[]).includes(visibility);
