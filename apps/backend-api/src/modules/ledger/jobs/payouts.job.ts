// The payout jobs (T-073): verify a payout account, and send-then-settle a payout. Each is safe to run
// twice — the account is re-checked under its lock, and the payout is claimed before it is sent and
// settled under its lock and its journal keys.
import { DelayedError, type Job } from 'bullmq';
import type { QueueFactory } from '../../../platform/queue/factory.js';
import { verifyPayoutAccount, type VerifyPayoutAccountDeps } from '../services/payoutAccount.service.js';
import {
  PayoutStillPendingError,
  processPayout,
  type PayoutDispatchDeps,
} from '../services/payoutDispatch.service.js';

export const PROCESS_PAYOUT_QUEUE = 'ledger.process-payout';
export const VERIFY_PAYOUT_ACCOUNT_QUEUE = 'ledger.verify-payout-account';

/**
 * A pending transfer backs off for about twenty minutes in all (5 s doubling, eight tries); the
 * webhook and the five-minute sweep each start a fresh one after that.
 */
export const PAYOUT_JOB_ATTEMPTS = 8;
export const PAYOUT_JOB_BACKOFF_MS = 5_000;

export interface ProcessPayoutJob {
  payoutId: string;
  /** How many times this job has waited on a pending transfer; drives the poll delay. */
  polls?: number;
}

/** 5 s, doubling, capped at 15 minutes between polls of a transfer the provider has not finished. */
export const PAYOUT_POLL_MAX_MS = 15 * 60_000;
export const payoutPollDelayMs = (polls: number): number =>
  Math.min(PAYOUT_JOB_BACKOFF_MS * 2 ** Math.min(polls, 20), PAYOUT_POLL_MAX_MS);

export interface VerifyPayoutAccountJob {
  payoutAccountId: string;
}

/**
 * A transfer still pending is not a failed attempt: the job is moved back to delayed and polls again,
 * without spending one of its attempts or reaching the dead-letter queue. The poll is bounded by the
 * dispatch service's own age cap — a day without a final answer moves the payout to NEEDS_REVIEW and
 * the job then completes. Real failures (a provider outage, a defect) still use the attempts.
 */
export async function processPayoutJob(
  deps: PayoutDispatchDeps,
  data: ProcessPayoutJob,
  job?: Pick<Job<ProcessPayoutJob>, 'updateData' | 'moveToDelayed'>,
  token?: string,
): Promise<string> {
  try {
    return await processPayout(deps, data.payoutId);
  } catch (error) {
    if (!(error instanceof PayoutStillPendingError) || !job || !token) throw error;
    const polls = data.polls ?? 0;
    await job.updateData({ ...data, polls: polls + 1 });
    await job.moveToDelayed(Date.now() + payoutPollDelayMs(polls), token);
    throw new DelayedError();
  }
}

export const verifyPayoutAccountJob = (deps: VerifyPayoutAccountDeps, data: VerifyPayoutAccountJob) =>
  verifyPayoutAccount(deps, data.payoutAccountId);

const jobOptions = {
  attempts: PAYOUT_JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: PAYOUT_JOB_BACKOFF_MS },
};

/**
 * Keyed by the payout, so the requested event delivered twice queues one job. The sweep passes
 * `deduplicate: false`: BullMQ keeps a failed job's id and silently ignores re-adding it.
 */
export const enqueueProcessPayout = async (
  queues: QueueFactory,
  payoutId: string,
  { deduplicate = true }: { deduplicate?: boolean } = {},
): Promise<void> => {
  await queues
    .producer<ProcessPayoutJob>(PROCESS_PAYOUT_QUEUE)
    .add('process', { payoutId }, { ...jobOptions, ...(deduplicate ? { jobId: `payout-${payoutId}` } : {}) });
};

export const enqueueVerifyPayoutAccount = async (
  queues: QueueFactory,
  payoutAccountId: string,
  { deduplicate = true }: { deduplicate?: boolean } = {},
): Promise<void> => {
  await queues
    .producer<VerifyPayoutAccountJob>(VERIFY_PAYOUT_ACCOUNT_QUEUE)
    .add(
      'verify',
      { payoutAccountId },
      { ...jobOptions, ...(deduplicate ? { jobId: `payout-account-${payoutAccountId}` } : {}) },
    );
};
