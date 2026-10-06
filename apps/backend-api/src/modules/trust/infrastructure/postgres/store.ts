// What this module needs from persistence, as a port.
//
// The services and the jobs take this rather than a `Db`, so the decisions they exist to make —
// which status a verdict produces, what a duplicate identifier does, whether a level is earned —
// are testable against a hand-written stub with no database at all. `bindStore(db)` in module.ts is
// the one place SQL lives, and the one place a transaction is opened.
//
// The port is deliberately thin: it moves rows, it does not decide anything. Every rule lives in
// `domain/` or in a service above it. The one exception is noted on `applyIdentityOutcome`.
import type { IdentifierType, KycProvider, VerificationRequestStatus } from './schema/enums.js';
import type { VerificationRequest } from './schema/requests.js';

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
  verificationType: IdentifierType | 'LIVENESS';
  targetLevel: number;
  ttlMinutes: number;
  selfieStorageRef?: string;
  attemptCount: number;
}

export interface ProviderCallInput {
  requestId: string;
  provider: KycProvider;
  callType: IdentifierType | 'LIVENESS';
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

export interface IdentityFactsRow {
  identifierVerified: boolean;
  /** Which document a liveness check should be matched against: the most recently verified one. */
  latestVerifiedIdentifier?: IdentifierType;
  livenessPassed: boolean;
  levelAttainedAt?: Date;
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
  markProviderPending(requestId: string, provider: KycProvider): Promise<void>;
  recordProviderCall(input: ProviderCallInput): Promise<void>;
  /**
   * Insert the outcome row and move the request, in one transaction.
   *
   * It does NOT catch the §6.3 uniqueness violation: the caller does, because what to do about a
   * duplicate identifier is §7's rule and not a persistence detail — and because a fake store that
   * throws it is how that rule gets tested without a database.
   */
  applyIdentityOutcome(input: IdentityOutcomeInput): Promise<void>;
  applyLivenessOutcome(input: LivenessOutcomeInput): Promise<void>;
  /**
   * §7's branch: the identifier passed, but it is already verified on another account.
   *
   * Writes the outcome row WITHOUT a `verified_at` (so the index does not claim the number for an
   * account nobody approved), parks the request in MANUAL_REVIEW, and publishes
   * `verification.duplicate_identity_detected`. Neither approval nor rejection — a human decides,
   * and T-052 builds the queue they decide in.
   */
  applyDuplicateIdentity(input: DuplicateIdentityInput): Promise<void>;
  /** Who verified this identifier first, for the duplicate event. Undefined if the row is gone. */
  findIdentifierOwner(type: IdentifierType, hash: Buffer): Promise<string | undefined>;
  identityFacts(userId: string): Promise<IdentityFactsRow>;
  /** Writes the append-only change row and moves identity's column, in one transaction. */
  grantLevel(input: GrantInput): Promise<LevelOutcome>;
  revokeLevel(input: RevokeInput): Promise<LevelOutcome>;
  findKycSelfie(fileId: string): Promise<SelfieFile | undefined>;
  countAttempts(userId: string, verificationType: string): Promise<number>;
  expireStale(now: Date): Promise<ExpiredRequest[]>;
}
