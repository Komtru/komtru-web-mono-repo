// The payout jobs (T-073): verify a payout account, and send-then-settle a payout. Each is safe to run
// twice — the account is re-checked under its lock, and the payout is claimed before it is sent and
// settled under its lock and its journal keys.
import type { QueueFactory } from '../../../platform/queue/factory.js';
import { verifyPayoutAccount, type VerifyPayoutAccountDeps } from '../services/payoutAccount.service.js';
import { processPayout, type PayoutDispatchDeps } from '../services/payoutDispatch.service.js';

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
}

export interface VerifyPayoutAccountJob {
  payoutAccountId: string;
}

export const processPayoutJob = (deps: PayoutDispatchDeps, data: ProcessPayoutJob) =>
  processPayout(deps, data.payoutId);

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
