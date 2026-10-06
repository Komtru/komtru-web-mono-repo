// M6 D3's `KycProviderAdapter`: the seam every provider call crosses.
//
// The decision this interface encodes is that the vendor is not load-bearing in the schema. Direct
// NIMC and NIBSS integration is not available to a platform at Komtru's stage (§8), so the real
// question is *which* licensed reseller, and that answer will change — the vendor space is young and
// price-competitive. One interface, one implementation per vendor, and switching is a config flip.
//
// T-051 adds `verifyBusiness` and `verifyBankAccountName` to this same interface; D3 names five
// methods and this ticket uses three. The two absent ones are a scope boundary, not an omission.
import type { IdentifierType, KycProvider } from '../infrastructure/postgres/schema/enums.js';

/**
 * What a provider can say about a check.
 *
 * `PENDING` is not a failure and not a success: liveness and document-authenticity checks commonly
 * queue for a human or a second model on the provider's side (D4), so "accepted, ask again later" is
 * a first-class answer rather than an error the caller has to interpret.
 */
export type CheckVerdict = 'PASSED' | 'FAILED' | 'LOW_CONFIDENCE' | 'PENDING';

/**
 * What goes to the provider, and what never comes back into this program.
 *
 * Every field here is transient: it exists between the request body and the provider call. Nothing
 * on this type is persisted — the schema has no column for a name, a date of birth or a number.
 */
export interface IdentityClaim {
  /** The normalised NIN or BVN. Held in memory for one call (D1). */
  identifier: string;
  firstName: string;
  lastName: string;
  /** ISO date. Optional: a provider that cannot match a DOB returns `dobMatch: undefined`. */
  dateOfBirth?: string;
}

export interface IdentityCheckResult {
  verdict: CheckVerdict;
  /** D1's retrieval key: how a later audit reaches the provider's own record of this call. */
  providerReference: string;
  nameMatchScore?: number;
  dobMatch?: boolean;
  /** BVN only: the BVN-registered phone against M1's verified one. */
  phoneMatch?: boolean;
  /** Why the provider said no, in the provider's terms. Shown to the user through §11's status. */
  failureReason?: string;
}

export interface LivenessCheckInput {
  /** An M20 file id (D5). The adapter is given a reference, never bytes. */
  selfieStorageRef: string;
  /** Which identity document the selfie is matched to — §4 forbids a liveness check with nothing to match. */
  matchedAgainst: IdentifierType;
}

export interface LivenessCheckResult {
  verdict: CheckVerdict;
  providerReference: string;
  matchScore: number;
  livenessPassed: boolean;
  failureReason?: string;
}

export interface KycProviderAdapter {
  /** What lands in `provider` on every row this adapter's answer produces. */
  readonly provider: KycProvider;
  verifyNin(claim: IdentityClaim): Promise<IdentityCheckResult>;
  verifyBvn(claim: IdentityClaim): Promise<IdentityCheckResult>;
  checkLiveness(input: LivenessCheckInput): Promise<LivenessCheckResult>;
}
