// M6 D3's `KycProviderAdapter`: the seam every provider call crosses.
//
// The decision this interface encodes is that the vendor is not load-bearing in the schema. Direct
// NIMC and NIBSS integration is not available to a platform at Komtru's stage (§8), so the real
// question is *which* licensed reseller, and that answer will change — the vendor space is young and
// price-competitive. One interface, one implementation per vendor, and switching is a config flip.
//
// T-051 added `verifyBusiness` and `verifyBankAccountName`, so all five of D3's methods are now
// here and the interface is complete as the spec describes it. Address proof is NOT a sixth: §6.6
// gives `address_checks` no provider columns at all, which is the spec saying a proof of address is
// a document a person weighs rather than a verdict a vendor returns.
import type { RejectionCode } from './rejection.js';
import type {
  BankMatchResult,
  IdentifierType,
  KycProvider,
} from '../infrastructure/postgres/schema/enums.js';

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
  /**
   * Why the provider said no, in the provider's own terms.
   *
   * For logs and for whoever is reading a vendor's documentation beside a failing call. It is NOT
   * what the user is shown and it is NOT what is persisted — `failureCode` is both (see
   * `domain/rejection.ts`), because a provider's error string cannot tell VF1 whether to offer a
   * resubmit or a support link.
   */
  failureReason?: string;
  /**
   * The adapter's own mapping of its answer onto this platform's rejection taxonomy.
   *
   * It belongs to the adapter because only the adapter knows which of its vendor's twelve failure
   * strings mean "blurry photo" and which mean "no such record" — that is the one piece of
   * provider-specific knowledge the rest of the module must not contain. Absent means "it failed and
   * I cannot say why", and `classifyIdentityFailure` supplies the honest default.
   */
  failureCode?: RejectionCode;
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
  failureCode?: RejectionCode;
}

/**
 * What goes to a CAC check. Transient, like `IdentityClaim` — but only half of it is sensitive.
 *
 * The RC number is public record and IS persisted (§6.5). The submitter's name is not persisted
 * anywhere in this module and travels only so the provider can answer the question that decides
 * `officers_match`: is this person listed as an officer of that registration?
 */
export interface BusinessClaim {
  /** The normalised RC number (see `normaliseRcNumber`). */
  rcNumber: string;
  /** The submitter, for the officer check. Not stored. */
  firstName: string;
  lastName: string;
}

export interface BusinessCheckResult {
  verdict: CheckVerdict;
  providerReference: string;
  /** What CAC has on file. This becomes the `expected_name` of the bank match that follows. */
  registeredBusinessName?: string;
  /** `BUSINESS_NAME`, `LIMITED_LIABILITY`, … — whatever the registry calls it. */
  businessType?: string;
  /** The registry's own status string: `active`, `inactive`, `not found`. */
  cacStatus?: string;
  /** Whether the submitter is a registered officer. Undefined when the provider does not say. */
  officersMatch?: boolean;
  failureReason?: string;
  failureCode?: RejectionCode;
}

/**
 * What goes to a bank name-match.
 *
 * `accountNumber` is the whole number and is held for exactly one call, the same contract
 * `IdentityClaim.identifier` has: §6.5 keeps only the last four digits, because M8's
 * `payout_accounts` is the account of record and a second copy here is a second thing to leak.
 */
export interface BankAccountClaim {
  accountNumber: string;
  bankCode: string;
  /** The name the account must match — the CAC-registered business name, never a typed one. */
  expectedName: string;
}

export interface BankMatchCheckResult {
  verdict: CheckVerdict;
  providerReference: string;
  /** What the bank returned for that account. Absent when the account could not be resolved. */
  resolvedAccountName?: string;
  matchResult: BankMatchResult;
  matchScore?: number;
  failureReason?: string;
  failureCode?: RejectionCode;
}

export interface KycProviderAdapter {
  /** What lands in `provider` on every row this adapter's answer produces. */
  readonly provider: KycProvider;
  verifyNin(claim: IdentityClaim): Promise<IdentityCheckResult>;
  verifyBvn(claim: IdentityClaim): Promise<IdentityCheckResult>;
  checkLiveness(input: LivenessCheckInput): Promise<LivenessCheckResult>;
  verifyBusiness(claim: BusinessClaim): Promise<BusinessCheckResult>;
  verifyBankAccountName(claim: BankAccountClaim): Promise<BankMatchCheckResult>;
}
