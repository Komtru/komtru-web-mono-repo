// The funding jobs (T-072): verify a charge, process a stored webhook delivery, and sweep up
// deliveries whose first enqueue never happened. Each one is safe to run twice: the settling it
// does is under the attempt's row lock and the journal's idempotency key.
import type { Db } from '../../../db/index.js';
import type { Logger } from '../../../platform/logger.js';
import type { QueueFactory } from '../../../platform/queue/factory.js';
import type { VerifiedChargeView } from '../domain/funding.js';
import type { PaymentProviderAdapter } from '../domain/providerAdapter.js';
import { listStaleDeliveries } from '../infrastructure/postgres/paymentsRepository.js';
import { processDelivery, settleCharge, type SettleResult } from '../services/webhookIngest.service.js';

export const VERIFY_CHARGE_QUEUE = 'ledger.verify-charge';
export const PROCESS_PAYMENT_WEBHOOK_QUEUE = 'ledger.process-payment-webhook';

/**
 * A pay-with-transfer can take minutes to settle, so a still-pending verify backs off for about
 * twenty minutes in all (5 s doubling, eight tries) before it dead-letters; the webhook, the buyer's
 * "check again" and the sweep each start a fresh one after that.
 */
export const FUNDING_JOB_ATTEMPTS = 8;
export const FUNDING_JOB_BACKOFF_MS = 5_000;

/** Deliveries unprocessed this long are re-queued by the sweep. */
export const STALE_DELIVERY_MS = 2 * 60_000;
export const SWEEP_BATCH = 100;

export interface VerifyChargeJob {
  reference: string;
}

export interface ProcessPaymentWebhookJob {
  /** The `payment_provider_webhooks` row id, as a string: bigint does not survive JSON. */
  webhookId: string;
}

export interface FundingJobDeps {
  db: Db;
  logger: Logger;
  verify: (reference: string) => Promise<VerifiedChargeView>;
  parse: PaymentProviderAdapter['parseWebhookEvent'];
}

export async function verifyChargeJob(deps: FundingJobDeps, data: VerifyChargeJob): Promise<SettleResult> {
  const verified = await deps.verify(data.reference);
  return settleCharge(deps, data.reference, verified);
}

export async function processPaymentWebhookJob(
  deps: FundingJobDeps,
  data: ProcessPaymentWebhookJob,
): Promise<string> {
  return processDelivery(deps, BigInt(data.webhookId));
}

const jobOptions = {
  attempts: FUNDING_JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: FUNDING_JOB_BACKOFF_MS },
};

export const enqueueVerifyCharge = async (queues: QueueFactory, reference: string): Promise<void> => {
  await queues.producer<VerifyChargeJob>(VERIFY_CHARGE_QUEUE).add('verify', { reference }, jobOptions);
};

/**
 * Keyed by the row, so a replayed delivery cannot queue a second job while one is waiting. The sweep
 * passes `deduplicate: false`: BullMQ keeps a failed job's id, and re-adding it is silently ignored,
 * which would make the sweep a no-op for exactly the rows it exists to rescue.
 */
export const enqueuePaymentWebhook = async (
  queues: QueueFactory,
  webhookId: bigint,
  { deduplicate = true }: { deduplicate?: boolean } = {},
): Promise<void> => {
  await queues
    .producer<ProcessPaymentWebhookJob>(PROCESS_PAYMENT_WEBHOOK_QUEUE)
    .add(
      'process',
      { webhookId: String(webhookId) },
      { ...jobOptions, ...(deduplicate ? { jobId: `webhook-${String(webhookId)}` } : {}) },
    );
};

export async function sweepPaymentWebhooks(deps: {
  db: Db;
  logger: Logger;
  enqueue: (webhookId: bigint) => Promise<void>;
  now?: Date;
}): Promise<{ requeued: number }> {
  const now = deps.now ?? new Date();
  const stale = await listStaleDeliveries(deps.db, new Date(now.getTime() - STALE_DELIVERY_MS), SWEEP_BATCH);
  for (const id of stale) await deps.enqueue(id);
  if (stale.length) deps.logger.warn({ requeued: stale.length }, 'ledger: re-queued unprocessed webhooks');
  return { requeued: stale.length };
}
