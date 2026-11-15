// What the merchant module (T-055) asks of trust: run the CAC lookup for an application's RC number, and
// read back what it found. Both are reads of, or requests for, T-051's own checks; neither decides anything.
//
// `requestBusinessEvidence` is `submitBusinessCheck` plus the enqueue the HTTP controller does, with the
// ordinary refusals turned into outcomes. An application is reviewed by a person with whatever evidence
// exists: "the applicant has not verified their identity yet" is a row in the evidence matrix, not an
// exception that fails the application's submit.
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { isUniqueViolation } from '../../../db/errors.js';
import type { Encryption } from '../../../platform/crypto/encryption.js';
import { ApiError } from '../../../platform/errors.js';
import type { Logger } from '../../../platform/logger.js';
import type { QueueFactory } from '../../../platform/queue/factory.js';
import { TRUST_QUEUES, type BusinessCheckJob } from '../domain/queues.js';
import { businessVerifications } from '../infrastructure/postgres/schema/business.js';
import { verificationRequests } from '../infrastructure/postgres/schema/requests.js';
import type { TrustStore } from '../infrastructure/postgres/store.js';
import { submitBusinessCheck } from './business.service.js';

export interface BusinessEvidenceDeps {
  store: TrustStore;
  encryption: Encryption;
  requestTtlMinutes: number;
  logger: Logger;
  queues: QueueFactory;
}

export type BusinessEvidenceRequest =
  | { outcome: 'ENQUEUED'; requestId: string }
  | { outcome: 'ALREADY_VERIFIED' }
  | { outcome: 'IN_FLIGHT' }
  | {
      outcome: 'BLOCKED';
      code: 'IDENTITY_VERIFICATION_REQUIRED' | 'INVALID_RC_NUMBER' | 'ACCOUNT_NOT_ACTIVE';
    };

export async function requestBusinessEvidence(
  deps: BusinessEvidenceDeps,
  input: { userId: string; rcNumber: string },
): Promise<BusinessEvidenceRequest> {
  // Before the submit, not after: a verified business or a running check must cost no billed call and
  // no request row, and neither is an error for the application that asked.
  if (await deps.store.findVerifiedBusiness(input.userId)) return { outcome: 'ALREADY_VERIFIED' };
  const open = await deps.store.listOpenRequests(input.userId);
  if (open.some((request) => request.verificationType === 'CAC')) return { outcome: 'IN_FLIGHT' };

  let submitted;
  try {
    submitted = await submitBusinessCheck(
      {
        store: deps.store,
        encryption: deps.encryption,
        requestTtlMinutes: deps.requestTtlMinutes,
        logger: deps.logger,
      },
      { userId: input.userId, rcNumber: input.rcNumber },
    );
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === 'IDENTITY_VERIFICATION_REQUIRED') {
        return { outcome: 'BLOCKED', code: 'IDENTITY_VERIFICATION_REQUIRED' };
      }
      if (error.status === 422) return { outcome: 'BLOCKED', code: 'INVALID_RC_NUMBER' };
      if (error.status === 401 || error.status === 403)
        return { outcome: 'BLOCKED', code: 'ACCOUNT_NOT_ACTIVE' };
      if (error.status === 409) return { outcome: 'IN_FLIGHT' };
    }
    if (isUniqueViolation(error, 'verification_requests_one_in_flight')) return { outcome: 'IN_FLIGHT' };
    throw error;
  }

  try {
    await deps.queues.producer<BusinessCheckJob>(TRUST_QUEUES.BUSINESS_CHECK).add('check', submitted.job, {
      // The request id, so a redelivery cannot queue a second billed provider call.
      jobId: submitted.requestId,
      // The sealed claim is a Redis value: gone the moment the work is, as the controller does it.
      removeOnComplete: true,
      removeOnFail: { age: 24 * 60 * 60 },
    });
  } catch (error) {
    // Committed already; `trust.expire-stale` frees the slot if nobody works it.
    deps.logger.error(
      { err: error, requestId: submitted.requestId },
      'trust: the CAC check for a merchant application could not be enqueued; the sweep will expire it',
    );
  }
  return { outcome: 'ENQUEUED', requestId: submitted.requestId };
}

export type BusinessEvidenceState = 'NOT_RUN' | 'PENDING' | 'VERIFIED' | 'FAILED' | 'MANUAL_REVIEW';

export interface BusinessEvidence {
  state: BusinessEvidenceState;
  /** The RC number the lookup was run on, as stored (normalised). */
  rcNumber: string | null;
  registeredBusinessName: string | null;
  cacStatus: string | null;
  officersMatch: boolean | null;
}

const NOT_RUN: BusinessEvidence = {
  state: 'NOT_RUN',
  rcNumber: null,
  registeredBusinessName: null,
  cacStatus: null,
  officersMatch: null,
};

/**
 * What the applicant's CAC lookup found: their verified business if they have one, else the outcome of
 * their latest CAC request. A read over T-051's tables; it triggers nothing and writes nothing.
 */
export async function readBusinessEvidence(
  db: Pick<Db, 'select'>,
  userId: string,
): Promise<BusinessEvidence> {
  const [verified] = await db
    .select()
    .from(businessVerifications)
    .where(and(eq(businessVerifications.userId, userId), isNotNull(businessVerifications.verifiedAt)))
    .limit(1);
  const [request] = await db
    .select({ id: verificationRequests.id, status: verificationRequests.status })
    .from(verificationRequests)
    .where(and(eq(verificationRequests.userId, userId), eq(verificationRequests.verificationType, 'CAC')))
    .orderBy(desc(verificationRequests.submittedAt))
    .limit(1);
  if (!request && !verified) return NOT_RUN;

  // The business row of the latest attempt exists once the provider answered (a failed lookup writes none).
  const [attempt] = request
    ? await db
        .select()
        .from(businessVerifications)
        .where(eq(businessVerifications.requestId, request.id))
        .limit(1)
    : [];
  const row = verified ?? attempt;
  const base = {
    rcNumber: row?.cacRcNumber ?? null,
    registeredBusinessName: row?.registeredBusinessName ?? null,
    cacStatus: row?.cacStatus ?? null,
    officersMatch: row?.officersMatch ?? null,
  };
  if (verified) return { state: 'VERIFIED', ...base };
  switch (request?.status) {
    case 'APPROVED':
      return { state: 'VERIFIED', ...base };
    case 'MANUAL_REVIEW':
      return { state: 'MANUAL_REVIEW', ...base };
    case 'REJECTED':
    case 'EXPIRED':
    case 'PROVIDER_FAILED':
      return { state: 'FAILED', ...base };
    default:
      return { state: 'PENDING', ...base };
  }
}
