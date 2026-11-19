// The user-facing half of M6: accepting a submission, and answering "where am I".
//
// Nothing here calls a provider. The whole of this file runs on the request path, and the T-028
// boundary keeps a provider client out of it by construction — what it produces instead is a sealed
// job for the worker to run.
import { ApiError } from '../../../platform/errors.js';
import type { Encryption } from '../../../platform/crypto/encryption.js';
import type { HmacHasher } from '../../../platform/crypto/hmac.js';
import type { Logger } from '../../../platform/logger.js';
import { isUniqueViolation } from '../../../db/errors.js';
import { isValidIdentifier, normaliseIdentifier } from '../domain/identifiers.js';
import { IDENTITY_VERIFIED_LEVEL, levelNumber } from '../domain/levels.js';
import { describeRejection, type RejectionReason } from '../domain/rejection.js';
import type { IdentityCheckJob, LivenessCheckJob } from '../domain/queues.js';
import type { IdentifierType } from '../infrastructure/postgres/schema/enums.js';
import type { TrustStore } from '../infrastructure/postgres/store.js';
import { assertActive, assertContactVerified, inFlightConflict } from './submission.js';

export interface VerificationDeps {
  store: TrustStore;
  hasher: HmacHasher;
  encryption: Encryption;
  requestTtlMinutes: number;
  logger: Logger;
}

export interface SubmitIdentifierInput {
  userId: string;
  type: IdentifierType;
  identifier: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
}

export interface SubmitResult<J> {
  requestId: string;
  status: string;
  /**
   * Enqueued by the caller AFTER the request row is committed.
   *
   * Returned rather than enqueued here because an enqueue is not transactional: a job that starts
   * before its row exists reads nothing and marks the request failed. The HTTP controller owns the
   * ordering, and `trust.expire-stale` is the floor underneath a job that was never enqueued at all.
   */
  job: J;
}

/** The ladder lives in `submission.ts` now: T-051 added three more submitters that need it. */
const assertEligible = (subject: Parameters<typeof assertActive>[0]) =>
  assertContactVerified(assertActive(subject));

export async function submitIdentifierCheck(
  deps: VerificationDeps,
  input: SubmitIdentifierInput,
): Promise<SubmitResult<IdentityCheckJob>> {
  assertEligible(await deps.store.findSubject(input.userId));

  const identifier = normaliseIdentifier(input.identifier);
  if (!isValidIdentifier(input.type, identifier)) {
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      `That ${input.type} does not look right`,
      'A NIN or BVN is eleven digits.',
      [{ path: input.type.toLowerCase(), message: 'must be eleven digits' }],
    );
  }

  /**
   * Already verified this type? Refuse here, before a provider call is spent.
   *
   * The job can cope with it — the §6.3 index would fire and the self-duplicate branch settles it —
   * but that costs a billed call to learn something this row already knew, and the honest answer to
   * "verify my NIN again" is that it is done.
   */
  const facts = await deps.store.identityFacts(input.userId);
  if (facts.verifiedTypes.includes(input.type)) {
    throw new ApiError(
      409,
      'CONFLICT',
      `Your ${input.type} is already verified`,
      'There is nothing more to do for this check.',
    );
  }

  const attemptCount = (await deps.store.countAttempts(input.userId, input.type)) + 1;

  const request = await createRequest(deps, {
    userId: input.userId,
    verificationType: input.type,
    targetLevel: IDENTITY_VERIFIED_LEVEL,
    ttlMinutes: deps.requestTtlMinutes,
    attemptCount,
  });

  return {
    requestId: request.id,
    status: request.status,
    job: {
      requestId: request.id,
      // The whole claim, not just the number: a name and a date of birth sitting in Redis in the
      // clear is the same class of exposure, and sealing one field of three is the kind of
      // half-measure that reads as compliance.
      sealed: deps.encryption.encrypt(
        JSON.stringify({
          identifier,
          firstName: input.firstName,
          lastName: input.lastName,
          ...(input.dateOfBirth === undefined ? {} : { dateOfBirth: input.dateOfBirth }),
        }),
      ),
    },
  };
}

export interface SubmitLivenessInput {
  userId: string;
  selfieFileId: string;
}

export async function submitLivenessCheck(
  deps: VerificationDeps,
  input: SubmitLivenessInput,
): Promise<SubmitResult<LivenessCheckJob>> {
  assertEligible(await deps.store.findSubject(input.userId));

  const selfie = await deps.store.findKycSelfie(input.selfieFileId);
  /**
   * Absent, tombstoned, someone else's, or not a KYC document: one 404, byte-identical.
   *
   * The posture T-040 established on retrieval, for the same reason — distinguishing them turns the
   * endpoint into an oracle for whether a given file id exists and who uploaded it.
   */
  if (!selfie || selfie.uploaderUserId !== input.userId || selfie.category !== 'KYC_DOCUMENT') {
    throw new ApiError(404, 'NOT_FOUND', 'We could not find that photo');
  }

  // M6 §4: liveness is matched AGAINST an identity document. With nothing to match it is not a
  // weaker check, it is a meaningless one — so this is a refusal, not a check that silently passes.
  const facts = await deps.store.identityFacts(input.userId);
  if (!facts.identifierVerified) {
    throw new ApiError(
      409,
      'CONFLICT',
      'Verify your NIN or BVN first',
      'A liveness photo is matched against a verified identity number, so that step comes first.',
    );
  }

  const attemptCount = (await deps.store.countAttempts(input.userId, 'LIVENESS')) + 1;
  const request = await createRequest(deps, {
    userId: input.userId,
    verificationType: 'LIVENESS',
    targetLevel: IDENTITY_VERIFIED_LEVEL,
    ttlMinutes: deps.requestTtlMinutes,
    selfieStorageRef: selfie.id,
    attemptCount,
  });

  return { requestId: request.id, status: request.status, job: { requestId: request.id } };
}

/**
 * The one place the in-flight constraint is translated.
 *
 * Read through `isUniqueViolation`, which walks the `cause` chain: drizzle 0.45 wraps the driver's
 * error, so a top-level `error.code` is `undefined` here and the 23505 would escape as a 500 on a
 * path that has a perfectly good 409 to give (src/db/errors.ts). Two modules shipped that bug.
 */
async function createRequest(deps: VerificationDeps, input: Parameters<TrustStore['createRequest']>[0]) {
  try {
    return await deps.store.createRequest(input);
  } catch (error) {
    if (isUniqueViolation(error, 'verification_requests_one_in_flight'))
      throw await inFlightConflict(deps.store, input.userId, input.verificationType);
    throw error;
  }
}

export interface VerificationStatus {
  level: string;
  levelNumber: number;
  levelAttainedAt: string | null;
  /**
   * What §4 still wants, as the booleans the screens render.
   *
   * Level 2's two, plus level 3's two. They are flat rather than nested by level because J2 and the
   * seller verification screen both render one checklist, and a client that has to know which level
   * a requirement belongs to in order to tick a box is a client reimplementing §4.
   */
  requirements: {
    identifier: boolean;
    liveness: boolean;
    business: boolean;
    businessBankAccount: boolean;
  };
  inFlight: {
    requestId: string;
    type: string;
    status: string;
    submittedAt: string;
    expiresAt: string;
  }[];
  /**
   * The most recent rejection per check, structured — this is what VF1 and BVR1 render.
   *
   * `inFlight` alone could never drive either screen: a rejected request is not in flight, so
   * without this the only thing a client could say after a failure is that nothing is happening.
   * The `reason` is the whole `RejectionReason` rather than a code, so the copy lives on the server
   * and a fix to a confusing sentence ships without a client release.
   */
  rejections: {
    requestId: string;
    type: string;
    decidedAt: string | null;
    reason: RejectionReason;
  }[];
}

/**
 * M6 §11's status endpoint, and the contract screens J2 and VF1 read.
 *
 * It carries no masked value, no provider reference and no score. A user asking "am I verified"
 * needs the answer and what is left to do; echoing the stored shadow of their own number back at
 * them adds nothing and puts it in one more log, one more cache and one more crash report.
 */
export async function readVerificationStatus(
  deps: Pick<VerificationDeps, 'store'>,
  userId: string,
): Promise<VerificationStatus> {
  const subject = await deps.store.findSubject(userId);
  if (!subject) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to see your verification status');

  const [facts, business, open, rejected] = await Promise.all([
    deps.store.identityFacts(userId),
    deps.store.businessFacts(userId),
    deps.store.listOpenRequests(userId),
    deps.store.listRecentRejections(userId),
  ]);

  return {
    level: subject.verificationLevel,
    levelNumber: levelNumber(subject.verificationLevel),
    levelAttainedAt: facts.levelAttainedAt?.toISOString() ?? null,
    requirements: {
      identifier: facts.identifierVerified,
      liveness: facts.livenessPassed,
      business: business.cacVerified,
      businessBankAccount: business.businessBankMatched,
    },
    inFlight: open.map((request) => ({
      requestId: request.id,
      type: request.verificationType,
      status: request.status,
      submittedAt: request.submittedAt.toISOString(),
      expiresAt: request.expiresAt.toISOString(),
    })),
    rejections: rejected.map((request) => ({
      requestId: request.requestId,
      type: request.verificationType,
      decidedAt: request.decidedAt?.toISOString() ?? null,
      // `?? ''` rather than a branch: `describeRejection` is total and falls back to
      // NEEDS_HUMAN_REVIEW, so a rejection written before codes existed still renders something.
      reason: describeRejection(request.rejectionReason ?? ''),
    })),
  };
}

/**
 * What the browser needs to run the Youverify liveness SDK, and the reference that ties whatever it
 * produces back to this request.
 *
 * The merchant key is served from here rather than baked into the frontend as a `NEXT_PUBLIC_*`
 * variable on purpose: those are inlined at build time, so rotating the key would need a rebuild of
 * every web app before it took effect. Served per request, a rotation lands on the next call.
 */
export interface LivenessSession {
  publicMerchantKey: string;
  /** Whether the SDK should talk to Youverify's sandbox. Derived from the base URL, never typed. */
  sandbox: boolean;
  /** The opaque reference to pass as the SDK's `metadata.reference`. */
  reference: string;
  requestId: string;
}

export interface StartLivenessSessionDeps extends VerificationDeps {
  youverify: { publicMerchantKey: string; baseUrl: string } | undefined;
  /** Mints the reference. Injected so a test can assert it is used rather than guess its shape. */
  mintReference: () => string;
}

export async function startLivenessSession(
  deps: StartLivenessSessionDeps,
  input: { userId: string },
): Promise<LivenessSession> {
  if (!deps.youverify) {
    throw new ApiError(
      503,
      'VERIFICATION_PROVIDER_UNAVAILABLE',
      'Identity checks are unavailable right now',
      'No liveness provider is configured on this environment.',
    );
  }

  assertEligible(await deps.store.findSubject(input.userId));

  // M6 §4, the same refusal `submitLivenessCheck` makes: a liveness check matched against nothing
  // is not a weaker check, it is a meaningless one. Checked BEFORE the session is minted so the
  // user is not sent into a camera flow that could only ever be discarded.
  const facts = await deps.store.identityFacts(input.userId);
  if (!facts.identifierVerified) {
    throw new ApiError(
      409,
      'CONFLICT',
      'Verify your NIN or BVN first',
      'A liveness check is matched against a verified identity number, so that step comes first.',
    );
  }
  // Already done. `submitIdentifierCheck` refuses a verified type for the same reason — before a
  // provider call is spent — and without this an API caller could mint a billable session and put
  // a "Not approved" banner on the VF1 of somebody who is already verified.
  if (facts.livenessPassed) {
    throw new ApiError(409, 'CONFLICT', 'Your selfie check is already done');
  }

  /**
   * Random, and deliberately not the request id.
   *
   * This value is handed to the browser and echoed back through Youverify's webhook, so it is the
   * one field in a delivery that an attacker can choose. If it were the request id — a value its
   * own owner can see — someone could run a liveness check on themselves and name a different
   * request. Unguessable and minted here, it cannot name a request the caller does not own.
   */
  const reference = deps.mintReference();
  const attemptCount = (await deps.store.countAttempts(input.userId, 'LIVENESS')) + 1;
  const request = await createRequest(deps, {
    userId: input.userId,
    verificationType: 'LIVENESS',
    targetLevel: IDENTITY_VERIFIED_LEVEL,
    ttlMinutes: deps.requestTtlMinutes,
    providerSessionRef: reference,
    attemptCount,
  });

  // Straight to PROVIDER_PENDING: the provider has it the moment the browser opens the modal, and
  // there is no job of ours between here and the webhook that would otherwise move it.
  await deps.store.markProviderPending(request.id, 'YOUVERIFY');

  return {
    publicMerchantKey: deps.youverify.publicMerchantKey,
    sandbox: deps.youverify.baseUrl.includes('sandbox'),
    reference,
    requestId: request.id,
  };
}
