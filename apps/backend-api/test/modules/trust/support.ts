// A hand-written TrustStore and the pieces around it, so this module's decisions can be tested
// without a database. The SQL behind the real store is covered by test/integration/verification.int.test.ts.
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { AppConfig } from '../../../src/config/env.js';
import { createEncryption, type Encryption } from '../../../src/platform/crypto/encryption.js';
import { createHmacHasher, type HmacHasher } from '../../../src/platform/crypto/hmac.js';
import { createLogger, type Logger } from '../../../src/platform/logger.js';
import type { SocketGateway } from '../../../src/modules/socket/index.js';
import type {
  BankMatchCheckResult,
  BusinessCheckResult,
  IdentityCheckResult,
  KycProviderAdapter,
  LivenessCheckResult,
} from '../../../src/modules/trust/domain/provider.js';
import type {
  SocialLookupResult,
  SocialProofAdapter,
} from '../../../src/modules/trust/domain/social-proof.js';
import type { SocialProofClaim, VerificationRequest } from '../../../src/modules/trust/index.js';
import type {
  AddressSubmissionInput,
  BankMatchOutcomeInput,
  BankNameMatchRecord,
  BusinessFactsRow,
  BusinessOutcomeInput,
  BusinessOwner,
  DuplicateBusinessInput,
  DuplicateIdentityInput,
  ExpiredRequest,
  GrantInput,
  IdentityFactsRow,
  IdentityOutcomeInput,
  LevelOutcome,
  LivenessOutcomeInput,
  ProviderCallInput,
  RejectedRequestRow,
  RevokeInput,
  SelfieFile,
  SocialProofClaimInput,
  SocialProofDecisionInput,
  TrustStore,
  VerificationSubject,
  VerifiedBusiness,
} from '../../../src/modules/trust/infrastructure/postgres/store.js';

export const silentLogger = (): Logger => createLogger({ log: { level: 'silent', format: 'json' } } as never);

/** 32 bytes of hex: `parseEncryptionKey` wants a real key, and a test should use a real one. */
export const testEncryption = (): Encryption =>
  createEncryption({ crypto: { encryptionKey: 'a1'.repeat(32) } } as AppConfig);

export const testHasher = (): HmacHasher => createHmacHasher('pepper'.padEnd(32, 'x'));

export const requestRow = (overrides: Partial<VerificationRequest> = {}): VerificationRequest => ({
  id: randomUUID(),
  userId: randomUUID(),
  verificationType: 'NIN',
  status: 'SUBMITTED',
  provider: null,
  providerReference: null,
  targetLevel: 2,
  attemptCount: 0,
  selfieStorageRef: null,
  providerSessionRef: null,
  submittedAt: new Date(),
  providerCalledAt: null,
  decidedAt: null,
  expiresAt: new Date(Date.now() + 3_600_000),
  rejectionReason: null,
  metadata: null,
  ...overrides,
});

/** A `social_proof_claims` row, with the fields a test does not care about filled in. */
export const socialClaimRow = (overrides: Partial<SocialProofClaim> = {}): SocialProofClaim => ({
  id: randomUUID(),
  userId: randomUUID(),
  platform: 'INSTAGRAM',
  handle: 'techedge_ng',
  challengeCode: 'KOMTRU-ACDEFGHJ',
  verified: false,
  verifiedAt: null,
  lastCheckedAt: null,
  createdAt: new Date(),
  ...overrides,
});

export interface RecordedStore extends TrustStore {
  readonly requests: VerificationRequest[];
  readonly providerCalls: ProviderCallInput[];
  readonly identityOutcomes: IdentityOutcomeInput[];
  readonly duplicates: DuplicateIdentityInput[];
  readonly settledAlreadyVerified: { requestId: string }[];
  readonly livenessOutcomes: LivenessOutcomeInput[];
  readonly grants: GrantInput[];
  readonly revokes: RevokeInput[];
  // --- T-051 ---------------------------------------------------------------------------------
  readonly businessOutcomes: BusinessOutcomeInput[];
  readonly bankMatchOutcomes: BankMatchOutcomeInput[];
  readonly duplicateBusinesses: DuplicateBusinessInput[];
  readonly addressChecks: AddressSubmissionInput[];
  readonly socialClaimsCreated: SocialProofClaimInput[];
  readonly socialDecisions: SocialProofDecisionInput[];
}

export interface StubStoreOptions {
  subject?: VerificationSubject | undefined;
  facts?: Partial<IdentityFactsRow>;
  selfie?: SelfieFile | undefined;
  request?: VerificationRequest | undefined;
  openRequests?: VerificationRequest[];
  identifierOwner?: string | undefined;
  attempts?: number;
  expired?: ExpiredRequest[];
  createRequestThrows?: Error;
  applyIdentityOutcomeThrows?: Error;
  grantResult?: LevelOutcome;
  /** False simulates the request having been decided by someone else mid-call. */
  outcomeApplied?: boolean;
  /** What the conditional UPDATE behind `abandonLiveness` reports: false means it moved nothing. */
  livenessAbandoned?: boolean;
  // --- T-051 ---------------------------------------------------------------------------------
  /** §7's CAC branch: who already holds this RC as their one verified business. */
  businessOwner?: BusinessOwner | undefined;
  /** The caller's own verified business, which the bank name-match is run against. */
  verifiedBusiness?: VerifiedBusiness | undefined;
  businessFacts?: Partial<BusinessFactsRow>;
  bankNameMatch?: BankNameMatchRecord | undefined;
  socialClaim?: SocialProofClaim | undefined;
  /** Who has already PROVED the handle being claimed, if anybody. */
  verifiedHandleOwner?: string | undefined;
  /** The name the user's verified NIN/BVN matched. Absent by default would refuse every CAC submit. */
  identityName?: { firstName: string; lastName: string } | undefined;
  /** The user already holds a verified claim on the platform. */
  hasVerifiedSocialClaim?: boolean;
  /** Throws on the first settle only, then succeeds: drives the unique-index race branches. */
  settleSocialThrows?: Error;
  socialClaims?: SocialProofClaim[];
  rejections?: RejectedRequestRow[];
  createAddressCheckThrows?: Error;
  createSocialProofClaimThrows?: Error;
  applyBusinessOutcomeThrows?: Error;
  /** False simulates `settleSocialProofClaim` finding the claim already verified or gone. */
  socialSettled?: boolean;
}

/** Records what it was asked to write, so a test asserts over the writes rather than over SQL. */
export function stubStore(options: StubStoreOptions = {}): RecordedStore {
  const requests: VerificationRequest[] = [];
  const providerCalls: ProviderCallInput[] = [];
  const identityOutcomes: IdentityOutcomeInput[] = [];
  const duplicates: DuplicateIdentityInput[] = [];
  const settledAlreadyVerified: { requestId: string }[] = [];
  const livenessOutcomes: LivenessOutcomeInput[] = [];
  const grants: GrantInput[] = [];
  const revokes: RevokeInput[] = [];
  const businessOutcomes: BusinessOutcomeInput[] = [];
  const bankMatchOutcomes: BankMatchOutcomeInput[] = [];
  const duplicateBusinesses: DuplicateBusinessInput[] = [];
  const addressChecks: AddressSubmissionInput[] = [];
  const socialClaimsCreated: SocialProofClaimInput[] = [];
  const socialDecisions: SocialProofDecisionInput[] = [];
  let thrownOnce = false;
  let businessThrownOnce = false;
  let socialThrownOnce = false;

  return {
    requests,
    providerCalls,
    identityOutcomes,
    duplicates,
    settledAlreadyVerified,
    livenessOutcomes,
    grants,
    revokes,
    businessOutcomes,
    bankMatchOutcomes,
    duplicateBusinesses,
    addressChecks,
    socialClaimsCreated,
    socialDecisions,

    // `in` rather than `=== undefined`: a test that passes `{ subject: undefined }` is saying "this
    // user is gone", which is a case worth being able to express.
    findSubject: (userId) =>
      Promise.resolve(
        'subject' in options
          ? options.subject
          : { userId, status: 'ACTIVE', verificationLevel: 'CONTACT_VERIFIED' },
      ),

    createRequest: (input) => {
      if (options.createRequestThrows) return Promise.reject(options.createRequestThrows);
      const row = requestRow({
        userId: input.userId,
        verificationType: input.verificationType,
        targetLevel: input.targetLevel,
        attemptCount: input.attemptCount,
        selfieStorageRef: input.selfieStorageRef ?? null,
      });
      requests.push(row);
      return Promise.resolve(row);
    },

    abandonLiveness: () => Promise.resolve(options.livenessAbandoned ?? true),
    findRequest: () => Promise.resolve(options.request),
    listOpenRequests: () => Promise.resolve(options.openRequests ?? []),
    markProviderPending: () => Promise.resolve(options.outcomeApplied ?? true),
    recordProviderCall: (input) => {
      providerCalls.push(input);
      return Promise.resolve();
    },

    applyIdentityOutcome: (input) => {
      // Throws once, so a test can prove the retry-after-duplicate path rather than only the throw.
      if (options.applyIdentityOutcomeThrows && !thrownOnce) {
        thrownOnce = true;
        return Promise.reject(options.applyIdentityOutcomeThrows);
      }
      identityOutcomes.push(input);
      return Promise.resolve(options.outcomeApplied ?? true);
    },

    applyLivenessOutcome: (input) => {
      livenessOutcomes.push(input);
      return Promise.resolve(options.outcomeApplied ?? true);
    },

    applyDuplicateIdentity: (input) => {
      duplicates.push(input);
      return Promise.resolve(options.outcomeApplied ?? true);
    },

    settleAlreadyVerified: (input) => {
      settledAlreadyVerified.push({ requestId: input.request.id });
      return Promise.resolve(true);
    },
    findIdentifierOwner: () => Promise.resolve(options.identifierOwner),

    findVerifiedIdentityName: () =>
      Promise.resolve(
        'identityName' in options ? options.identityName : { firstName: 'Ada', lastName: 'Obi' },
      ),

    identityFacts: () =>
      Promise.resolve({
        identifierVerified: false,
        verifiedTypes: [],
        livenessPassed: false,
        ...options.facts,
      }),

    grantLevel: (input) => {
      grants.push(input);
      return Promise.resolve(options.grantResult ?? { changed: true, from: 1, to: input.toLevel });
    },

    revokeLevel: (input) => {
      revokes.push(input);
      return Promise.resolve({ changed: true, from: 2, to: input.toLevel });
    },

    findKycSelfie: () => Promise.resolve(options.selfie),
    countAttempts: () => Promise.resolve(options.attempts ?? 0),
    expireStale: () => Promise.resolve(options.expired ?? []),

    // --- T-051 -------------------------------------------------------------------------------

    applyBusinessOutcome: (input) => {
      // Throws once, so a test can drive the duplicate-RC branch and then the write that follows it.
      if (options.applyBusinessOutcomeThrows && !businessThrownOnce) {
        businessThrownOnce = true;
        return Promise.reject(options.applyBusinessOutcomeThrows);
      }
      businessOutcomes.push(input);
      return Promise.resolve(options.outcomeApplied ?? true);
    },

    applyBankMatchOutcome: (input) => {
      bankMatchOutcomes.push(input);
      return Promise.resolve(options.outcomeApplied ?? true);
    },

    applyDuplicateBusiness: (input) => {
      duplicateBusinesses.push(input);
      return Promise.resolve(options.outcomeApplied ?? true);
    },

    findBusinessOwner: () => Promise.resolve(options.businessOwner),
    findVerifiedBusiness: () => Promise.resolve(options.verifiedBusiness),

    businessFacts: () =>
      Promise.resolve({
        currentLevel: 2,
        cacVerified: false,
        businessBankMatched: false,
        ...options.businessFacts,
      }),

    findBankNameMatch: () => Promise.resolve(options.bankNameMatch),

    createAddressCheck: (input) => {
      if (options.createAddressCheckThrows) return Promise.reject(options.createAddressCheckThrows);
      addressChecks.push(input);
      const row = requestRow({
        userId: input.userId,
        verificationType: 'ADDRESS',
        status: 'MANUAL_REVIEW',
        targetLevel: input.targetLevel,
        attemptCount: input.attemptCount,
      });
      requests.push(row);
      return Promise.resolve(row);
    },

    createSocialProofClaim: (input) => {
      if (options.createSocialProofClaimThrows) {
        return Promise.reject(options.createSocialProofClaimThrows);
      }
      socialClaimsCreated.push(input);
      return Promise.resolve(
        socialClaimRow({
          userId: input.userId,
          platform: input.platform,
          handle: input.handle,
          challengeCode: input.challengeCode,
        }),
      );
    },

    findVerifiedHandleOwner: () => Promise.resolve(options.verifiedHandleOwner),
    hasVerifiedSocialClaim: () => Promise.resolve(options.hasVerifiedSocialClaim ?? false),
    findSocialProofClaim: () => Promise.resolve(options.socialClaim),

    listSocialProofClaims: ({ page, limit }) => {
      const all = options.socialClaims ?? [];
      return Promise.resolve({
        items: all.slice((page - 1) * limit, page * limit),
        total: all.length,
      });
    },

    settleSocialProofClaim: (input) => {
      if (options.settleSocialThrows && !socialThrownOnce) {
        socialThrownOnce = true;
        return Promise.reject(options.settleSocialThrows);
      }
      socialDecisions.push(input);
      return Promise.resolve(options.socialSettled ?? true);
    },

    listRecentRejections: () => Promise.resolve(options.rejections ?? []),
  };
}

/** A drizzle-shaped unique violation: the `pg` error on `cause`, which is what db/errors.ts walks. */
export const uniqueViolation = (constraint: string): Error =>
  new Error('Failed query', {
    cause: Object.assign(new Error('duplicate key'), { code: '23505', constraint }),
  });

export interface Emitted {
  userId: string;
  event: string;
  payload: unknown;
}

/** A gateway that records instead of broadcasting, so a test asserts who was told what. */
export const recordingGateway = (): SocketGateway & { emitted: Emitted[] } => {
  const emitted: Emitted[] = [];
  return {
    emitted,
    emitToUser: (userId, event, payload) => void emitted.push({ userId, event, payload }),
    emitToRoom: () => {},
    registerRoomAuthorizer: () => {},
    disconnectUser: () => {},
    connectionCount: () => 0,
  };
};

export interface AdapterScript {
  identity?: IdentityCheckResult | Error;
  liveness?: LivenessCheckResult | Error;
  business?: BusinessCheckResult | Error;
  bankMatch?: BankMatchCheckResult | Error;
}

/**
 * An adapter that answers exactly what a test tells it to, and counts its calls.
 *
 * `.then(...)` rather than an `async` body for the same reason the real fake uses it: an Error given
 * to this helper must arrive as a REJECTION, which is what a job's retry path is written against.
 */
export const scriptedAdapter = (script: AdapterScript = {}): KycProviderAdapter & { calls: number } => {
  const notScripted = () => new Error('scriptedAdapter: this method was not scripted');
  const adapter = {
    calls: 0,
    provider: 'FAKE' as const,
    verifyNin: () => answer<IdentityCheckResult>(script.identity),
    verifyBvn: () => answer<IdentityCheckResult>(script.identity),
    checkLiveness: () => answer<LivenessCheckResult>(script.liveness),
    verifyBusiness: () => answer<BusinessCheckResult>(script.business),
    verifyBankAccountName: () => answer<BankMatchCheckResult>(script.bankMatch),
  };
  function answer<T>(scripted: T | Error | undefined): Promise<T> {
    return Promise.resolve().then(() => {
      adapter.calls += 1;
      if (scripted === undefined) throw notScripted();
      if (scripted instanceof Error) throw scripted;
      return scripted;
    });
  }
  return adapter;
};

/**
 * `expect.objectContaining`, typed.
 *
 * Vitest declares it as `any`, which `no-unsafe-assignment` rejects the moment it is put in a
 * variable or an object literal. One cast here beats one per assertion.
 */
export const containing = (shape: Record<string, unknown>): unknown =>
  expect.objectContaining(shape) as unknown;

/** A social-proof lookup that answers what a test tells it to, and counts its calls. */
export const scriptedSocialAdapter = (
  scripted?: SocialLookupResult | Error,
): SocialProofAdapter & { calls: number } => {
  const adapter = {
    calls: 0,
    name: 'scripted',
    lookup: () =>
      Promise.resolve().then(() => {
        adapter.calls += 1;
        if (scripted === undefined) throw new Error('scriptedSocialAdapter: not scripted');
        if (scripted instanceof Error) throw scripted;
        return scripted;
      }),
  };
  return adapter;
};
