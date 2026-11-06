// The HTTP layer's own job: turn a request into a submission, and enqueue the work AFTER the row
// that work depends on is committed.
import type { Paged } from '@komtru/shared-types';
import type { QueueFactory } from '../../../platform/queue/factory.js';
import type { Encryption } from '../../../platform/crypto/encryption.js';
import type { HmacHasher } from '../../../platform/crypto/hmac.js';
import type { Logger } from '../../../platform/logger.js';
import {
  TRUST_QUEUES,
  type BankMatchJob,
  type BusinessCheckJob,
  type IdentityCheckJob,
  type LivenessCheckJob,
  type SocialProofCheckJob,
} from '../domain/queues.js';
import type { IdentifierType, SocialProofPlatform } from '../infrastructure/postgres/schema/enums.js';
import type { TrustStore } from '../infrastructure/postgres/store.js';
import {
  readVerificationStatus,
  submitIdentifierCheck,
  submitLivenessCheck,
  type VerificationDeps,
  type VerificationStatus,
} from '../services/verification.service.js';
import { submitAddressCheck, type AddressSubmission } from '../services/address.service.js';
import { submitBankMatchCheck } from '../services/bankMatch.service.js';
import { submitBusinessCheck } from '../services/business.service.js';
import {
  claimSocialHandle,
  listSocialProof,
  requestSocialProofCheck,
  type SocialProofClaimView,
} from '../services/socialProof.service.js';

/** Lazily resolved: the module's routes exist before `start()` has given it a database. */
export interface TrustHttpDeps {
  store: () => TrustStore;
  hasher: () => HmacHasher;
  encryption: () => Encryption;
  requestTtlMinutes: () => number;
  logger: () => Logger;
  queues: () => QueueFactory;
}

const serviceDeps = (deps: TrustHttpDeps): VerificationDeps => ({
  store: deps.store(),
  hasher: deps.hasher(),
  encryption: deps.encryption(),
  requestTtlMinutes: deps.requestTtlMinutes(),
  logger: deps.logger(),
});

export interface SubmissionResponse {
  requestId: string;
  status: string;
}

/** Everything this module puts on a queue. Each one is a request (or claim) id plus a sealed claim. */
type TrustJob = IdentityCheckJob | LivenessCheckJob | BusinessCheckJob | BankMatchJob | SocialProofCheckJob;

export async function submitNin(
  deps: TrustHttpDeps,
  input: { userId: string; body: { nin: string; firstName: string; lastName: string; dateOfBirth?: string } },
): Promise<SubmissionResponse> {
  return enqueueIdentity(deps, {
    userId: input.userId,
    type: 'NIN',
    identifier: input.body.nin,
    firstName: input.body.firstName,
    lastName: input.body.lastName,
    ...(input.body.dateOfBirth === undefined ? {} : { dateOfBirth: input.body.dateOfBirth }),
  });
}

export async function submitBvn(
  deps: TrustHttpDeps,
  input: { userId: string; body: { bvn: string; firstName: string; lastName: string; dateOfBirth?: string } },
): Promise<SubmissionResponse> {
  return enqueueIdentity(deps, {
    userId: input.userId,
    type: 'BVN',
    identifier: input.body.bvn,
    firstName: input.body.firstName,
    lastName: input.body.lastName,
    ...(input.body.dateOfBirth === undefined ? {} : { dateOfBirth: input.body.dateOfBirth }),
  });
}

async function enqueueIdentity(
  deps: TrustHttpDeps,
  input: {
    userId: string;
    type: IdentifierType;
    identifier: string;
    firstName: string;
    lastName: string;
    dateOfBirth?: string;
  },
): Promise<SubmissionResponse> {
  const submitted = await submitIdentifierCheck(serviceDeps(deps), input);
  await enqueue(deps, TRUST_QUEUES.IDENTITY_CHECK, submitted.requestId, submitted.job);
  return { requestId: submitted.requestId, status: submitted.status };
}

export async function submitLiveness(
  deps: TrustHttpDeps,
  input: { userId: string; body: { selfieFileId: string } },
): Promise<SubmissionResponse> {
  const submitted = await submitLivenessCheck(serviceDeps(deps), {
    userId: input.userId,
    selfieFileId: input.body.selfieFileId,
  });
  await enqueue(deps, TRUST_QUEUES.LIVENESS_CHECK, submitted.requestId, submitted.job);
  return { requestId: submitted.requestId, status: submitted.status };
}

/**
 * Enqueued after the request row is committed, and allowed to fail.
 *
 * An enqueue is not transactional, so a throw here would leave a committed request the caller has
 * already been charged an in-flight slot for, and tell them it failed. `trust.expire-stale` is the
 * floor underneath it: a request nobody worked on expires and frees the slot, which is a worse
 * outcome than a job running and a better one than a 500 on a row that exists.
 *
 * The job id is the request id, so a redelivery cannot queue a second provider call.
 */
async function enqueue(deps: TrustHttpDeps, queue: string, requestId: string, job: TrustJob): Promise<void> {
  try {
    await deps
      .queues()
      .producer<TrustJob>(queue)
      .add('check', job, {
        jobId: requestId,
        /**
         * The sealed claim is a Redis value. Dropping the job the moment it finishes means the
         * ciphertext does not outlive the work, and a failed one is kept only long enough to be
         * retried and inspected — D1 is about the number's lifetime, not only its spelling.
         */
        removeOnComplete: true,
        removeOnFail: { age: 24 * 60 * 60 },
      });
  } catch (error) {
    deps
      .logger()
      .error({ err: error, requestId }, 'trust: the check could not be enqueued; the sweep will expire it');
  }
}

export const status = (deps: TrustHttpDeps, userId: string): Promise<VerificationStatus> =>
  readVerificationStatus({ store: deps.store() }, userId);

// --- T-051 -------------------------------------------------------------------------------------

export async function submitBusiness(
  deps: TrustHttpDeps,
  input: { userId: string; body: { rcNumber: string } },
): Promise<SubmissionResponse> {
  const submitted = await submitBusinessCheck(
    {
      store: deps.store(),
      encryption: deps.encryption(),
      requestTtlMinutes: deps.requestTtlMinutes(),
      logger: deps.logger(),
    },
    { userId: input.userId, ...input.body },
  );
  await enqueue(deps, TRUST_QUEUES.BUSINESS_CHECK, submitted.requestId, submitted.job);
  return { requestId: submitted.requestId, status: submitted.status };
}

export async function submitBankAccount(
  deps: TrustHttpDeps,
  input: { userId: string; body: { accountNumber: string; bankCode: string } },
): Promise<SubmissionResponse> {
  const submitted = await submitBankMatchCheck(
    {
      store: deps.store(),
      encryption: deps.encryption(),
      requestTtlMinutes: deps.requestTtlMinutes(),
      logger: deps.logger(),
    },
    { userId: input.userId, ...input.body },
  );
  await enqueue(deps, TRUST_QUEUES.BANK_MATCH, submitted.requestId, submitted.job);
  return { requestId: submitted.requestId, status: submitted.status };
}

/**
 * The one submission with no enqueue.
 *
 * §6.6 gives `address_checks` no provider columns, which is the spec saying a proof of address is a
 * document a person weighs rather than a verdict a vendor returns — so there is no job to queue and
 * no provider to wait for. The store parks the request in MANUAL_REVIEW for T-052's reviewer.
 */
export const submitAddress = (
  deps: TrustHttpDeps,
  input: {
    userId: string;
    body: {
      addressLine1: string;
      city: string;
      state: string;
      method: 'UTILITY_BILL' | 'BANK_STATEMENT';
      documentFileId: string;
    };
  },
): Promise<AddressSubmission> =>
  submitAddressCheck(
    { store: deps.store(), requestTtlMinutes: deps.requestTtlMinutes(), logger: deps.logger() },
    { userId: input.userId, ...input.body },
  );

const socialDeps = (deps: TrustHttpDeps) => ({ store: deps.store(), logger: deps.logger() });

export const claimSocialProof = (
  deps: TrustHttpDeps,
  input: { userId: string; body: { platform: SocialProofPlatform; handle: string } },
): Promise<SocialProofClaimView> =>
  claimSocialHandle(socialDeps(deps), { userId: input.userId, ...input.body });

export async function confirmSocialProof(
  deps: TrustHttpDeps,
  input: { userId: string; claimId: string },
): Promise<{ claimId: string }> {
  const requested = await requestSocialProofCheck(socialDeps(deps), input);
  await enqueue(deps, TRUST_QUEUES.SOCIAL_PROOF_CHECK, requested.claimId, requested.job);
  return { claimId: requested.claimId };
}

export const listSocialProofClaims = (
  deps: TrustHttpDeps,
  input: { userId: string; page: number; limit: number },
): Promise<Paged<SocialProofClaimView>> => listSocialProof(socialDeps(deps), input);
