// What T-052 decides without touching a database: which case a parked request becomes, what the
// advisory is told about it, which overrides are allowed at all, and when two rejections are "repeated".
import type { CaseFacts, CaseType } from '../../cases/index.js';
import { ENHANCED_LEVEL, IDENTITY_VERIFIED_LEVEL, MIN_TRUST_LEVEL } from './levels.js';
import type { VerificationType } from '../infrastructure/postgres/schema/enums.js';
import { ApiError } from '../../../platform/errors.js';

/** The subject type every review case carries; the subject id is the verification request id. */
export const REVIEW_SUBJECT_TYPE = 'verification_request';

/** M6 §9: "verification.rejected firing twice for the same user within 30 days". */
export const REPEATED_REJECTION_THRESHOLD = 2;
export const REPEATED_REJECTION_WINDOW_DAYS = 30;

/** Policy citations a decision carries when the analyst names none (T-107 requires one). */
export const DEFAULT_REVIEW_CITATION = 'M6 §6.8';
export const DUPLICATE_CITATION = 'M6 §7';

/**
 * The business half of M6 is KYB; everything about a person is IDENTITY. Address, document and
 * social-proof reviews are about the person's standing, so they are IDENTITY too.
 */
export const caseTypeFor = (type: VerificationType): CaseType =>
  type === 'CAC' || type === 'BANK_ACCOUNT_NAME_MATCH' ? 'KYB' : 'IDENTITY';

export const caseTitleFor = (type: VerificationType, reason: string): string =>
  reason === 'DUPLICATE_IDENTITY'
    ? `${type} already verified on another account`
    : `${type} needs a manual check`;

/**
 * Non-PII scalars only: the case index is not a copy of the subject (T-107). No names, no numbers, no
 * hashes; the user id and request id are already the case's subject and need no repeating.
 */
export function reviewFacts(input: {
  verificationType: VerificationType;
  reason: string;
  attemptCount: number;
}): CaseFacts {
  return {
    verificationType: input.verificationType,
    reason: input.reason,
    attemptCount: input.attemptCount,
    duplicateIdentity: input.reason === 'DUPLICATE_IDENTITY',
  };
}

export interface OverrideRequest {
  direction: 'GRANT' | 'REVOKE';
  toLevel: number;
  currentLevel: number;
}

const refuse = (detail: string): ApiError =>
  new ApiError(422, 'VALIDATION_FAILED', detail, 'That override is not allowed');

/**
 * `verification.override` moves a level outside the provider flow, and only inside the range M6 owns.
 * Level 4 is enhanced due diligence, which no code path in this module grants; levels below 2 are
 * identity's.
 */
export function assertOverrideAllowed(input: OverrideRequest): void {
  if (input.direction === 'GRANT') {
    if (input.toLevel >= ENHANCED_LEVEL) throw refuse('Level 4 is never granted by an override');
    if (input.toLevel < IDENTITY_VERIFIED_LEVEL) throw refuse('A grant must be to level 2 or 3');
    if (input.toLevel <= input.currentLevel) throw refuse('The user is already at or higher than that level');
    return;
  }
  if (input.toLevel < MIN_TRUST_LEVEL - 1) throw refuse('A revoke cannot go below level 1');
  if (input.toLevel >= input.currentLevel)
    throw refuse('A revoke must go to a lower level than the user holds');
}

/**
 * True when the count of REJECTED requests in the window has JUST reached the threshold. Exactly,
 * not "at least": a third rejection does not open a second ticket for the same run of failures.
 */
export const isRepeatedRejection = (rejectionsInWindow: number): boolean =>
  rejectionsInWindow === REPEATED_REJECTION_THRESHOLD;
