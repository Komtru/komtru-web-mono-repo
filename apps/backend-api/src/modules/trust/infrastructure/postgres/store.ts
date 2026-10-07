// What this module needs from persistence, as a port.
//
// The services and the jobs take this rather than a `Db`, so the decisions they exist to make —
// which status a verdict produces, what a duplicate identifier does, whether a level is earned —
// are testable against a hand-written stub with no database at all. `bindStore(db)` in module.ts is
// the one place SQL lives, and the one place a transaction is opened.
//
// The port is deliberately thin: it moves rows, it does not decide anything. Every rule lives in
// `domain/` or in a service above it. The one exception is noted on `applyIdentityOutcome`.
import type {
  AddressMethod,
  BankMatchResult,
  IdentifierType,
  KycProvider,
  SocialProofPlatform,
  VerificationDocumentType,
  VerificationRequestStatus,
  VerificationType,
} from './schema/enums.js';
import type { VerificationRequest } from './schema/requests.js';
import type { SocialProofClaim } from './schema/social-proof.js';

/** The slice of identity's `users` row a verification decision depends on. */
export interface VerificationSubject {
  userId: string;
  status: string;
  verificationLevel: string;
}

/** The slice of an M20 file record this module checks before it trusts a selfie reference. */
export interface SelfieFile {
  id: string;
  uploaderUserId: string;
  category: string;
}

export interface CreateRequestInput {
  userId: string;
  /**
   * Any of §6.1's eight. It was `IdentifierType | 'LIVENESS'` while T-050 was the only writer;
   * widening it to the enum is what lets the four T-051 checks share one umbrella row (§6.2) rather
   * than each growing a parallel lifecycle of its own.
   */
  verificationType: VerificationType;
  targetLevel: number;
  ttlMinutes: number;
  selfieStorageRef?: string;
  attemptCount: number;
}

export interface ProviderCallInput {
  requestId: string;
  provider: KycProvider;
  callType: VerificationType;
  latencyMs: number;
  succeeded: boolean;
  httpStatus?: number;
  errorKind?: string;
}

export interface IdentityOutcomeInput {
  request: VerificationRequest;
  type: IdentifierType;
  masked: string;
  hash: Buffer;
  provider: KycProvider;
  providerReference: string;
  nameMatchScore?: number;
  dobMatch?: boolean;
  phoneMatch?: boolean;
  requestStatus: VerificationRequestStatus;
  markVerified: boolean;
  rejectionReason?: string;
}

export interface DuplicateIdentityInput {
  request: VerificationRequest;
  type: IdentifierType;
  masked: string;
  hash: Buffer;
  provider: KycProvider;
  providerReference: string;
  nameMatchScore?: number;
  /** The account that verified it first. Null when the row has since been removed. */
  firstUserId: string | null;
}

export interface LivenessOutcomeInput {
  request: VerificationRequest;
  matchedAgainst: IdentifierType;
  matchScore: number;
  livenessPassed: boolean;
  provider: KycProvider;
  providerReference: string;
  requestStatus: VerificationRequestStatus;
  rejectionReason?: string;
}

export interface GrantInput {
  userId: string;
  toLevel: number;
  reason: string;
  actorType: 'PROVIDER_AUTO' | 'KYC_ANALYST' | 'SYSTEM';
  actorId?: string;
  triggeringRequestId?: string;
  provider: KycProvider;
}

export interface RevokeInput {
  userId: string;
  toLevel: number;
  reason: string;
  actorType: 'PROVIDER_AUTO' | 'KYC_ANALYST' | 'SYSTEM';
  actorId?: string;
}

export interface LevelOutcome {
  changed: boolean;
  from: number;
  to: number;
}

export interface BusinessOutcomeInput {
  request: VerificationRequest;
  cacRcNumber: string;
  registeredBusinessName: string;
  businessType?: string;
  cacStatus?: string;
  officersMatch?: boolean;
  provider: KycProvider;
  providerReference: string;
  requestStatus: VerificationRequestStatus;
  markVerified: boolean;
  rejectionReason?: string;
}

export interface BankMatchOutcomeInput {
  request: VerificationRequest;
  accountNumberMasked: string;
  bankCode: string;
  resolvedAccountName?: string;
  expectedName: string;
  matchResult: BankMatchResult;
  matchScore?: number;
  provider: KycProvider;
  providerReference: string;
  requestStatus: VerificationRequestStatus;
  rejectionReason?: string;
}

/** §7's CAC branch. The hash travels pre-computed, for the reason `rcNumberHash` documents. */
export interface DuplicateBusinessInput extends BusinessOutcomeInput {
  /** The account that verified this RC number first. Null when the row has since been removed. */
  firstUserId: string | null;
  /**
   * `rcNumberHash(...).toString('hex')`.
   *
   * Hashed rather than sent plain even though an RC number is public record, because it lands in
   * `trust.verification.duplicate_identity_detected`'s `identifierHashHex`, which every consumer
   * already reads as one opaque correlation key across every identifier type. It is computed by the
   * job, which holds the hasher, rather than here — the store moves rows and does not decide or
   * derive anything.
   */
  rcNumberHashHex: string;
}

export interface AddressSubmissionInput {
  userId: string;
  addressLine1: string;
  city: string;
  state: string;
  method: AddressMethod;
  documentRef?: string;
  documentType?: VerificationDocumentType;
  ttlMinutes: number;
  attemptCount: number;
  targetLevel: number;
}

/** §7's CAC adjustment: who holds this RC as their one verified business, if anybody. */
export interface BusinessOwner {
  userId: string;
  registeredBusinessName: string;
}

/** The slice of a verified business a bank name-match is run against. */
export interface VerifiedBusiness {
  cacRcNumber: string;
  registeredBusinessName: string;
}

export interface SocialProofClaimInput {
  userId: string;
  platform: SocialProofPlatform;
  handle: string;
  challengeCode: string;
}

export interface SocialProofDecisionInput {
  claimId: string;
  verified: boolean;
}

export interface IdentityFactsRow {
  identifierVerified: boolean;
  /** Which of NIN/BVN already carry a `verified_at` for this user. Empty when none do. */
  verifiedTypes: IdentifierType[];
  /** Which document a liveness check should be matched against: the most recently verified one. */
  latestVerifiedIdentifier?: IdentifierType;
  livenessPassed: boolean;
  levelAttainedAt?: Date;
}

/** §4's level-3 inputs, read back rather than inferred (see `earnedBusinessLevel`). */
export interface BusinessFactsRow {
  currentLevel: number;
  cacVerified: boolean;
  businessBankMatched: boolean;
}

/** What T-073 reads to decide whether a payout account may be made default. */
export interface BankNameMatchRecord {
  id: string;
  matchResult: BankMatchResult;
  resolvedAccountName: string | null;
  expectedName: string;
  checkedAt: Date;
}

/** The most recent terminal failure of a check — a rejection or an expiry — for VF1 and BVR1. */
export interface RejectedRequestRow {
  requestId: string;
  verificationType: VerificationType;
  /** A `RejectionCode`, as stored. Typed as `string` because the column cannot vouch for it. */
  rejectionReason: string | null;
  decidedAt: Date | null;
}

export interface ExpiredRequest {
  requestId: string;
  userId: string;
  verificationType: string;
  attemptCount: number;
}

export interface TrustStore {
  findSubject(userId: string): Promise<VerificationSubject | undefined>;
  /** Throws the in-flight unique violation; the service translates it (see db/errors.ts). */
  createRequest(input: CreateRequestInput): Promise<VerificationRequest>;
  findRequest(requestId: string): Promise<VerificationRequest | undefined>;
  listOpenRequests(userId: string): Promise<VerificationRequest[]>;
  /**
   * Moves an OPEN request to PROVIDER_PENDING. False means it was no longer open — the sweep
   * expired it, or a human decided it — and the caller must not call a provider.
   */
  markProviderPending(requestId: string, provider: KycProvider): Promise<boolean>;
  recordProviderCall(input: ProviderCallInput): Promise<void>;
  /**
   * Insert the outcome row and move the request, in one transaction.
   *
   * It does NOT catch the §6.3 uniqueness violation: the caller does, because what to do about a
   * duplicate identifier is §7's rule and not a persistence detail — and because a fake store that
   * throws it is how that rule gets tested without a database.
   *
   * Returns false when the request had already left the open set. The job reads the status once and
   * then spends seconds inside a provider call, so a blind `UPDATE … WHERE id = $1` would overwrite
   * an EXPIRED request with APPROVED and go on to grant a level the sweep had already denied.
   */
  applyIdentityOutcome(input: IdentityOutcomeInput): Promise<boolean>;
  applyLivenessOutcome(input: LivenessOutcomeInput): Promise<boolean>;
  /**
   * §7's branch: the identifier passed, but it is already verified on another account.
   *
   * Writes the outcome row WITHOUT a `verified_at` (so the index does not claim the number for an
   * account nobody approved), parks the request in MANUAL_REVIEW, and publishes
   * `verification.duplicate_identity_detected`. Neither approval nor rejection — a human decides,
   * and T-052 builds the queue they decide in.
   */
  applyDuplicateIdentity(input: DuplicateIdentityInput): Promise<boolean>;
  /**
   * §7's OTHER branch: the identifier is already verified — on the submitter's OWN account.
   *
   * Not a duplicate identity and not fraud, just a user submitting the same number twice. The first
   * outcome row stays the record; this only settles the second request as approved. Returns false
   * when the request had already moved on.
   */
  settleAlreadyVerified(input: {
    request: VerificationRequest;
    provider: KycProvider;
    providerReference: string;
  }): Promise<boolean>;
  /** Who verified this identifier first, for the duplicate event. Undefined if the row is gone. */
  findIdentifierOwner(type: IdentifierType, hash: Buffer): Promise<string | undefined>;
  identityFacts(userId: string): Promise<IdentityFactsRow>;
  /** Writes the append-only change row and moves identity's column, in one transaction. */
  grantLevel(input: GrantInput): Promise<LevelOutcome>;
  revokeLevel(input: RevokeInput): Promise<LevelOutcome>;
  findKycSelfie(fileId: string): Promise<SelfieFile | undefined>;
  countAttempts(userId: string, verificationType: string): Promise<number>;
  expireStale(now: Date): Promise<ExpiredRequest[]>;

  // --- T-051: business, bank name-match, address, social proof --------------------------------

  /**
   * The CAC outcome row and the request move, in one transaction. Same contract as
   * `applyIdentityOutcome`: false means the request had already left the open set, and the caller
   * must grant nothing.
   *
   * It does not catch `business_verifications_user_active_unique` either, for the same reason — what
   * to do about a second verified business on one account is a rule, not a persistence detail.
   */
  applyBusinessOutcome(input: BusinessOutcomeInput): Promise<boolean>;
  applyBankMatchOutcome(input: BankMatchOutcomeInput): Promise<boolean>;
  /**
   * §7's CAC branch: the registration is real, but another account already holds it as its one
   * verified business. Writes the outcome row WITHOUT a `verified_at`, parks the request in
   * MANUAL_REVIEW and publishes `trust.verification.duplicate_identity_detected`.
   */
  applyDuplicateBusiness(input: DuplicateBusinessInput): Promise<boolean>;
  /**
   * Who holds this RC number as their one verified business.
   *
   * Scoped to verified rows on purpose (§7): "has any user ever typed this number" is not the
   * question, because a rejected attempt by a fraudster would then lock out the real company.
   */
  findBusinessOwner(rcNumber: string): Promise<BusinessOwner | undefined>;
  /** The caller's own verified business, which a bank name-match is run against. */
  findVerifiedBusiness(userId: string): Promise<VerifiedBusiness | undefined>;
  businessFacts(userId: string): Promise<BusinessFactsRow>;
  /** T-073's read: the name-match on record for a payout account, if there is one. */
  findBankNameMatch(input: {
    userId: string;
    bankCode: string;
    accountNumberMasked: string;
  }): Promise<BankNameMatchRecord | undefined>;

  /**
   * The request row, the `address_checks` row and the supporting `verification_documents` row, in
   * one transaction. Returns the request, so the caller can report its id and status.
   */
  createAddressCheck(input: AddressSubmissionInput): Promise<VerificationRequest>;

  createSocialProofClaim(input: SocialProofClaimInput): Promise<SocialProofClaim>;
  /**
   * Who has already PROVED this handle, if anybody.
   *
   * `social_proof_claims_platform_handle` is partial on `verified = true` — deliberately, so a user
   * may abandon a mistyped claim and start another — which means creating a second UNVERIFIED claim
   * on a handle somebody else has proved does not violate it. Without this read the refusal was
   * unreachable: the user would be handed a code, go and publish it, and only then find out the
   * badge can never be granted. The index remains the enforcement point for the race; this is the
   * read that stops the ordinary case wasting the user's time, exactly as `identityFacts` does for
   * "your NIN is already verified".
   */
  findVerifiedHandleOwner(input: {
    platform: SocialProofPlatform;
    handle: string;
  }): Promise<string | undefined>;
  findSocialProofClaim(claimId: string): Promise<SocialProofClaim | undefined>;
  /**
   * Paginated, and the signature says so rather than returning the lot.
   *
   * The port originally read `listSocialProofClaims(userId): Promise<SocialProofClaim[]>` and the
   * service above it noted that the route would still declare `paginated: 'page'`. That is a route
   * declaring a promise the query underneath it does not keep: design §STEP 2's rule is "no
   * unpaginated SELECT anywhere, including admin-only, low-volume endpoints", and a verified claim
   * being capped at two per user is exactly the "it is small" argument the rule refuses — the
   * unverified attempts beside them are not capped by anything but a rate limit.
   */
  listSocialProofClaims(input: {
    userId: string;
    page: number;
    limit: number;
  }): Promise<{ items: SocialProofClaim[]; total: number }>;
  /**
   * Records the outcome of a lookup.
   *
   * `last_checked_at` moves on EVERY call, verified or not — it is what rate-limits a re-check, and
   * a failed lookup that leaves it untouched is a free retry loop against a third party's website.
   * Returns false when the claim was already verified or has gone.
   */
  settleSocialProofClaim(input: SocialProofDecisionInput): Promise<boolean>;
  /** The most recent terminally-failed request (REJECTED or EXPIRED) per type, for VF1 and BVR1. */
  listRecentRejections(userId: string): Promise<RejectedRequestRow[]>;
}
