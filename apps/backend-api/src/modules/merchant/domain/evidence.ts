// The evidence matrix (T-055): identity level, CAC lookup, documents present, bank name-match. These
// are evidence for a person, never a decision: nothing here approves, rejects or scores an application,
// and the only thing derived from it is the handful of scalar facts the advisory reads.
import type { CaseFacts } from '../../cases/index.js';
import type { MissingDocument } from './application.js';

export const IDENTITY_VERIFIED_LEVEL = 2;

export type CacLookupState = 'NOT_RUN' | 'PENDING' | 'VERIFIED' | 'FAILED' | 'MANUAL_REVIEW';
export type BankMatchState = 'NOT_RUN' | 'EXACT' | 'FUZZY_MATCH' | 'MISMATCH';

export interface EvidenceMatrix {
  /** `users.verification_level` as a number, 0 to 4. */
  identityLevel: number;
  cacLookup: {
    state: CacLookupState;
    registeredBusinessName?: string | null;
    cacStatus?: string | null;
    officersMatch?: boolean | null;
    /** Does the RC number on the application equal the one the lookup was run on. */
    rcMatchesApplication?: boolean;
  };
  documents: {
    required: string[];
    present: string[];
    missing: MissingDocument[];
    complete: boolean;
  };
  bankNameMatch: {
    state: BankMatchState;
    bankName?: string | null;
    accountNumberMasked?: string | null;
    resolvedAccountName?: string | null;
  };
}

/** Scalars only (the case index "must never become a copy of the subject"): what the advisory rules read. */
export function deriveFacts(matrix: EvidenceMatrix, input: { formComplete: boolean }): CaseFacts {
  return {
    checklistComplete: input.formComplete && matrix.documents.complete,
    identityLevel: matrix.identityLevel,
    identityVerified: matrix.identityLevel >= IDENTITY_VERIFIED_LEVEL,
    cacLookup: matrix.cacLookup.state,
    documentsComplete: matrix.documents.complete,
    bankNameMatch: matrix.bankNameMatch.state,
  };
}
