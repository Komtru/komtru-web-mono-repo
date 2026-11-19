// Adapted from kumtru/backend-apis/src/modules/files/domain/uploadPolicy.ts (T-001, not on the
// approved-lift list but the same shape): CUSTODY_EVIDENCE added, scope type from @komtru/shared-types.
import { FILE_VISIBILITY_BY_CATEGORY, type SessionScope } from '@komtru/shared-types';
import type { FileCategory, FileVisibility } from '../infrastructure/postgres/schema/enums.js';

/**
 * What a caller is allowed to ASK for at upload time.
 *
 * D2 says the uploading module sets the visibility class explicitly. It does not say every class is
 * available for every category, and it must not be: a consumer who could request
 * `{ category: 'KYC_DOCUMENT', visibility: 'PUBLIC' }` would be publishing their own identity
 * document to anyone with the file id — legal under D2 as literally written, and obviously wrong.
 *
 * The table itself lives in `@komtru/shared-types`, so the browser compiles against the same rule
 * this enforces. It used to be declared here alone, and four upload screens shipped asking for
 * `OTHER` + `PRIVATE_CASE` — a pair no release has ever accepted — because nothing they compiled
 * against knew the rule. Edit it there when a new category arrives, and `POOL_BY_CATEGORY` here.
 */
export const ALLOWED_VISIBILITY: Readonly<Record<FileCategory, readonly FileVisibility[]>> =
  FILE_VISIBILITY_BY_CATEGORY;

/**
 * `INTERNAL_ONLY` is a staff-origination class, whatever the category allows.
 *
 * A consumer uploading a file only staff can read is not a use case — it is a way to put bytes into
 * the internal-evidence namespace from outside, which is the shape of an attack rather than a feature.
 */
export const STAFF_ONLY_VISIBILITY: readonly FileVisibility[] = Object.freeze(['INTERNAL_ONLY']);

/**
 * Which module owns each category, derived rather than client-supplied.
 *
 * `file_records.owning_module` is provenance — the answer to "who asked for this file to exist" — and
 * a free-text field the client fills in is not provenance, it is a suggestion. Deriving it from the
 * category costs nothing and makes the column trustworthy.
 */
export const OWNING_MODULE: Readonly<Record<FileCategory, string>> = Object.freeze({
  PROFILE_PHOTO: 'identity',
  LISTING_IMAGE: 'merchant',
  KYC_DOCUMENT: 'trust',
  DISPUTE_EVIDENCE: 'disputes',
  CUSTODY_EVIDENCE: 'park',
  PROOF_OF_DELIVERY: 'logistics',
  TICKET_ATTACHMENT: 'support',
  CHAT_ATTACHMENT: 'disputes',
  OTHER: 'platform',
});

export type UploadRefusal = { ok: true } | { ok: false; reason: string };

export const checkUploadRequest = (input: {
  category: FileCategory;
  visibility: FileVisibility;
  scope: SessionScope;
}): UploadRefusal => {
  if (!ALLOWED_VISIBILITY[input.category].includes(input.visibility)) {
    return {
      ok: false,
      reason:
        `${input.category} files cannot be ${input.visibility}. Allowed: ` +
        `${ALLOWED_VISIBILITY[input.category].join(', ')}.`,
    };
  }

  if (STAFF_ONLY_VISIBILITY.includes(input.visibility) && input.scope !== 'STAFF') {
    return { ok: false, reason: `${input.visibility} files can only be uploaded from a staff session.` };
  }

  return { ok: true };
};
