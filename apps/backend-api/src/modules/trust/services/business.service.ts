// CAC business verification — the submission half (M6 §4's level-3 first requirement, screen SO3).
//
// As with the identity service, nothing here calls a provider: the whole file runs on the request
// path and the T-028 boundary keeps a provider client out of it by construction. What it produces is
// a sealed job for the worker.
//
// The one rule worth reading twice is `assertIdentityVerified`. §4 is explicit that level 3 requires
// level 2 FIRST, and the obvious place to enforce that is at the grant — but enforcing it only there
// means a level-1 user can submit a CAC number, spend a billed provider call, get an APPROVED
// request, and then sit at level 1 wondering why their badge never arrived. The refusal belongs
// where the user can act on it.
import { ApiError } from '../../../platform/errors.js';
import type { Encryption } from '../../../platform/crypto/encryption.js';
import type { Logger } from '../../../platform/logger.js';
import { isUniqueViolation } from '../../../db/errors.js';
import { isValidRcNumber, normaliseRcNumber } from '../domain/identifiers.js';
import { BUSINESS_VERIFIED_LEVEL, IDENTITY_VERIFIED_LEVEL, levelNumber } from '../domain/levels.js';
import type { BusinessCheckJob } from '../domain/queues.js';
import type { TrustStore, VerificationSubject } from '../infrastructure/postgres/store.js';
import type { SubmitResult } from './verification.service.js';
import { assertActive, inFlightConflict } from './submission.js';

export interface BusinessDeps {
  store: TrustStore;
  encryption: Encryption;
  requestTtlMinutes: number;
  logger: Logger;
}

export interface SubmitBusinessInput {
  userId: string;
  rcNumber: string;
}

/**
 * §4: "a business is operated by a verified human".
 *
 * A 409 rather than a 403, and with the detail spelling out which step comes first — this is the
 * same shape as the liveness service's "verify your NIN or BVN first", because it is the same
 * situation: a real user in the wrong order, not a user who may not do this at all.
 */
function assertIdentityVerified(subject: VerificationSubject): void {
  if (levelNumber(subject.verificationLevel) < IDENTITY_VERIFIED_LEVEL) {
    throw new ApiError(
      409,
      'IDENTITY_VERIFICATION_REQUIRED',
      'Verify your own identity first',
      'Business verification confirms a business belongs to a verified person, so your NIN or BVN and liveness check come first.',
    );
  }
}

export async function submitBusinessCheck(
  deps: BusinessDeps,
  input: SubmitBusinessInput,
): Promise<SubmitResult<BusinessCheckJob>> {
  const subject = assertActive(await deps.store.findSubject(input.userId));
  assertIdentityVerified(subject);

  const rcNumber = normaliseRcNumber(input.rcNumber);
  if (!isValidRcNumber(rcNumber)) {
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'That CAC number does not look right',
      'A CAC registration number is at least four letters and digits, with or without its RC prefix.',
      [{ path: 'rcNumber', message: 'must be a CAC registration number' }],
    );
  }

  /**
   * Already verified? Refuse before a provider call is spent.
   *
   * `business_verifications_user_active_unique` would catch it in the job, but that costs a billed
   * call to learn what this row already knows — and parks the user in MANUAL_REVIEW, which until
   * T-052 ships has no exit. The same guard `submitIdentifierCheck` has, for the same reason.
   */
  const existing = await deps.store.findVerifiedBusiness(input.userId);
  if (existing) {
    throw new ApiError(
      409,
      'CONFLICT',
      'Your business is already verified',
      `${existing.registeredBusinessName} is on file against this account.`,
    );
  }

  /**
   * The officer match runs against the name the provider matched on the user's own NIN or BVN.
   *
   * Never a name from the request: anyone able to type a real director's name would pass.
   */
  const identityName = await deps.store.findVerifiedIdentityName(input.userId);
  if (!identityName) {
    throw new ApiError(
      409,
      'IDENTITY_VERIFICATION_REQUIRED',
      'Verify your own identity first',
      'We match the business officers against the name on your verified NIN or BVN, and there is none on file yet.',
    );
  }

  const attemptCount = (await deps.store.countAttempts(input.userId, 'CAC')) + 1;

  let request;
  try {
    request = await deps.store.createRequest({
      userId: input.userId,
      verificationType: 'CAC',
      targetLevel: BUSINESS_VERIFIED_LEVEL,
      ttlMinutes: deps.requestTtlMinutes,
      attemptCount,
    });
  } catch (error) {
    if (isUniqueViolation(error, 'verification_requests_one_in_flight')) {
      throw await inFlightConflict(deps.store, input.userId, 'CAC');
    }
    throw error;
  }

  return {
    requestId: request.id,
    status: request.status,
    job: {
      requestId: request.id,
      // The names are personal data, so the whole claim is sealed: unsealed, Redis would hold them.
      sealed: deps.encryption.encrypt(
        JSON.stringify({ rcNumber, firstName: identityName.firstName, lastName: identityName.lastName }),
      ),
    },
  };
}
