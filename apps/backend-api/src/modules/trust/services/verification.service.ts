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
import { contactVerificationRequired } from '../domain/errors.js';
import { isValidIdentifier, normaliseIdentifier } from '../domain/identifiers.js';
import { IDENTITY_VERIFIED_LEVEL, levelNumber } from '../domain/levels.js';
import type { IdentityCheckJob, LivenessCheckJob } from '../domain/queues.js';
import type { IdentifierType } from '../infrastructure/postgres/schema/enums.js';
import type { TrustStore, VerificationSubject } from '../infrastructure/postgres/store.js';

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

/** M6 §2: a verified email and phone come first. Level 1 is identity's to grant, not ours to skip. */
const CONTACT_VERIFIED_LEVEL = 1;

function assertEligible(subject: VerificationSubject | undefined): VerificationSubject {
  // A principal the database no longer knows is not a 404 — the caller's session resolved against a
  // row that has since gone, and "sign in again" is the only honest answer.
  if (!subject) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to verify your identity');
  if (subject.status !== 'ACTIVE') {
    throw new ApiError(403, 'FORBIDDEN', 'This account cannot start a verification right now');
  }
  if (levelNumber(subject.verificationLevel) < CONTACT_VERIFIED_LEVEL) throw contactVerificationRequired();
  return subject;
}

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
    if (isUniqueViolation(error, 'verification_requests_one_in_flight')) {
      throw new ApiError(
        409,
        'CONFLICT',
        'That check is already running',
        'We are still working on your last submission. You will get a result shortly.',
      );
    }
    throw error;
  }
}
