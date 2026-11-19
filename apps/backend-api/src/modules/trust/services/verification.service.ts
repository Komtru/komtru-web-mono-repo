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
import type { TrustStore, VerificationSubject } from '../infrastructure/postgres/store.js';
import { assertActive, assertContactVerified, inFlightConflict } from './submission.js';

export interface VerificationDeps {
  store: TrustStore;
  hasher: HmacHasher;
  encryption: Encryption;
  requestTtlMinutes: number;
  /** `TRUST_ALLOW_NAME_OVERRIDE`. False substitutes the account's own name onto an identifier claim. */
  allowNameOverride: boolean;
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

const filled = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim() !== '';

const trimmedOrNull = (value: string | null | undefined): string | null =>
  filled(value) ? value.trim() : null;

export interface ClaimName {
  firstName: string;
  lastName: string;
}

/**
 * Which name the provider matches the number against.
 *
 * VF1 disables these fields on the production host, and that is worth doing — but it is a
 * property of a browser, and the request behind it can be sent by anything with a session. The
 * reason it matters: a person free to put any name beside any number can walk a stolen NIN
 * through guesses until the national record agrees, and the check that was supposed to prove who
 * they are instead tells them who the number belongs to.
 *
 * So when the operator has not allowed an override, the account's own profile name wins over
 * whatever arrived in the body — silently, because there is nothing for the person to fix: the
 * name being used IS theirs. The body is honoured only where there is no account name to stand
 * in, which is the one-word-`fullName` case; substituting a blank surname there would fail a
 * check the person could have passed.
 */
export function resolveClaimName(
  allowNameOverride: boolean,
  subject: Pick<VerificationSubject, 'firstName' | 'lastName'>,
  body: ClaimName,
): ClaimName {
  if (allowNameOverride) return body;
  if (!filled(subject.firstName) || !filled(subject.lastName)) return body;
  return { firstName: subject.firstName.trim(), lastName: subject.lastName.trim() };
}

export async function submitIdentifierCheck(
  deps: VerificationDeps,
  input: SubmitIdentifierInput,
): Promise<SubmitResult<IdentityCheckJob>> {
  const subject = assertEligible(await deps.store.findSubject(input.userId));

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

  const claimName = resolveClaimName(deps.allowNameOverride, subject, {
    firstName: input.firstName,
    lastName: input.lastName,
  });

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
          firstName: claimName.firstName,
          lastName: claimName.lastName,
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
  /**
   * The account's own declared name, for the NIN/BVN form to fill itself with.
   *
   * Either half is null when the profile has nothing usable there — a one-word `fullName` at
   * sign-up leaves no surname — and the screen reads that as "there is no name to lock to", which
   * is the same condition `resolveClaimName` uses to let the body choose. One fact, read the same
   * way on both sides, so the form cannot disable a field the server was never going to fill.
   */
  nameClaim: { firstName: string | null; lastName: string | null };
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
    nameClaim: { firstName: trimmedOrNull(subject.firstName), lastName: trimmedOrNull(subject.lastName) },
    inFlight: open.map((request) => ({
      requestId: request.id,
      type: request.verificationType,
      status: request.status,
      submittedAt: request.submittedAt.toISOString(),
      expiresAt: request.expiresAt.toISOString(),
    })),
    rejections: rejected
      /*
        An abandoned session is not the platform's word on anything.

        It shares the EXPIRED status with a swept request, so the query that finds "the most recent
        terminally-failed request per type" finds it too. Letting it through would put a failure
        banner and a "Try again" on VF1 for somebody who closed a camera — and worse, it would keep
        the screen out of the branch that renders the control to start over, which is the one thing
        they came back for.
      */
      .filter((request) => request.rejectionReason !== 'ABANDONED')
      .map((request) => ({
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
 * The person opened the camera flow and closed it without finishing.
 *
 * Ends the request so VF1's start branch renders again at once. Without it the row sits at
 * PROVIDER_PENDING until the §6.2 sweep expires it a day later, and for that day the screen shows
 * "We're checking" over a check nobody is performing — with no control to retry, because the start
 * branch only renders when nothing is in flight.
 *
 * The UPDATE goes first and the read only happens when it moved nothing. That ordering is the
 * concurrency control: ownership, type and status all live in the WHERE clause, so two `onClose`
 * calls cannot both conclude they are the one ending the session, and a close racing the sweep
 * loses cleanly instead of overwriting a decision.
 */
export async function abandonLivenessSession(
  deps: VerificationDeps,
  input: { userId: string; requestId: string },
): Promise<{ abandoned: boolean }> {
  if (await deps.store.abandonLiveness({ userId: input.userId, requestId: input.requestId })) {
    return { abandoned: true };
  }

  // Nothing moved. The row itself says why, and each answer is different to the caller.
  const request = await deps.store.findRequest(input.requestId);
  if (request === undefined || request.userId !== input.userId) {
    // One answer for "no such request" and "not yours": a 403 here would confirm that somebody
    // else's request id exists.
    throw new ApiError(404, 'NOT_FOUND', 'No such verification');
  }
  if (request.verificationType !== 'LIVENESS') {
    throw new ApiError(409, 'CONFLICT', 'Only a selfie check can be closed this way');
  }
  if (request.status === 'EXPIRED' && request.rejectionReason === 'ABANDONED') {
    // Idempotent on purpose. `onClose` can fire twice, and the call is retried over a connection
    // that may have dropped after the server already acted; a second close is not an error.
    return { abandoned: false };
  }
  // APPROVED, REJECTED, or a sweep that got there first. An approved liveness check is a level,
  // and discarding it here would quietly take one away.
  throw new ApiError(409, 'CONFLICT', 'This check has already been decided');
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
