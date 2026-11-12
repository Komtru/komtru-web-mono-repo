// The refund jobs (T-075): send-then-resolve a refund, and the backstop sweep. Each is safe to run
// twice: the refund is claimed before it is sent, never sent again once claimed, and resolved under
// its row lock and its journal key.
import { DelayedError, type Job } from 'bullmq';
import type { Db } from '../../../db/index.js';
import type { Logger } from '../../../platform/logger.js';
import type { QueueFactory } from '../../../platform/queue/factory.js';
import { refundsAwaitingDecision } from '../../trades/index.js';
import { staleInFlightRefunds } from '../infrastructure/postgres/refundsRepository.js';
import { decideRefund } from '../services/refund.service.js';
import {
  processRefund,
  RefundStillPendingError,
  type RefundDispatchDeps,
} from '../services/refundDispatch.service.js';

export const PROCESS_REFUND_QUEUE = 'ledger.process-refund';

/** A provider outage or a defect retries this often, 5 s doubling; a pending refund polls instead. */
export const REFUND_JOB_ATTEMPTS = 8;
export const REFUND_JOB_BACKOFF_MS = 5_000;

/** 5 s, doubling, capped at an hour between polls: a refund is slower than a transfer. */
export const REFUND_POLL_MAX_MS = 60 * 60_000;
export const refundPollDelayMs = (polls: number): number =>
  Math.min(REFUND_JOB_BACKOFF_MS * 2 ** Math.min(polls, 20), REFUND_POLL_MAX_MS);

export interface ProcessRefundJob {
  refundId: string;
  /** How many times this job has waited on a pending refund; drives the poll delay. */
  polls?: number;
  /**
   * Queued by the sweep: asks once and completes, pending or not. Only the dispatch's own job polls,
   * so a sweep every five minutes cannot stack a new poll chain beside it each time a long poll leaves
   * the row looking stale. A refund whose own chain was lost is still asked about every
   * `STALE_PROCESSING_REFUND_MS` by the sweep itself, and by its webhook.
   */
  sweep?: boolean;
}

/**
 * A refund still pending at the provider is not a failed attempt: the job moves back to delayed and
 * polls again, without spending an attempt. The poll is bounded by the dispatch service's own age cap
 * (a week, then NEEDS_REVIEW), after which the job completes. A sweep's job does not poll.
 */
export async function processRefundJob(
  deps: RefundDispatchDeps,
  data: ProcessRefundJob,
  job?: Pick<Job<ProcessRefundJob>, 'updateData' | 'moveToDelayed'>,
  token?: string,
): Promise<string> {
  try {
    return await processRefund(deps, data.refundId);
  } catch (error) {
    if (!(error instanceof RefundStillPendingError)) throw error;
    if (data.sweep) return 'PROCESSING';
    if (!job || !token) throw error;
    const polls = data.polls ?? 0;
    await job.updateData({ ...data, polls: polls + 1 });
    await job.moveToDelayed(Date.now() + refundPollDelayMs(polls), token);
    throw new DelayedError();
  }
}

const jobOptions = {
  attempts: REFUND_JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: REFUND_JOB_BACKOFF_MS },
};

/**
 * Keyed by the refund, so the escrow_refunded event delivered twice queues one job. The sweep's
 * re-queue is unkeyed — BullMQ keeps a finished job's id and silently ignores re-adding it — and marked
 * `sweep`, so it asks once rather than starting a second poll chain.
 */
export const enqueueProcessRefund = async (
  queues: QueueFactory,
  refundId: string,
  { sweep = false }: { sweep?: boolean } = {},
): Promise<void> => {
  await queues
    .producer<ProcessRefundJob>(PROCESS_REFUND_QUEUE)
    .add('process', sweep ? { refundId, sweep: true } : { refundId }, {
      ...jobOptions,
      ...(sweep ? {} : { jobId: `refund-${refundId}` }),
    });
};

/** A REQUESTED refund nobody has picked up after this long lost its dispatch job. */
export const STALE_REQUESTED_REFUND_MS = 2 * 60_000;
/** A PROCESSING refund untouched for this long is asked about again. */
export const STALE_PROCESSING_REFUND_MS = 30 * 60_000;
export const REFUND_SWEEP_BATCH = 100;

/**
 * The five-minute backstop: re-queues refunds whose dispatch never ran, and re-resolves refunds the
 * provider has gone quiet on — which is also what moves a never-named one to review after an hour.
 * Re-queuing is always safe, because a claimed refund is never sent twice.
 */
export async function sweepInFlightRefunds(deps: {
  db: Db;
  logger: Logger;
  enqueue: (refundId: string) => Promise<void>;
  now?: Date;
}): Promise<{ refunds: number }> {
  const now = deps.now ?? new Date();
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const rows = [
    ...(await staleInFlightRefunds(
      deps.db,
      ['REQUESTED'],
      ago(STALE_REQUESTED_REFUND_MS),
      REFUND_SWEEP_BATCH,
    )),
    ...(await staleInFlightRefunds(
      deps.db,
      ['PROCESSING'],
      ago(STALE_PROCESSING_REFUND_MS),
      REFUND_SWEEP_BATCH,
    )),
  ];
  for (const row of rows) await deps.enqueue(row.id);
  if (rows.length) deps.logger.warn({ refunds: rows.length }, 'ledger: re-queued stalled refunds');
  return { refunds: rows.length };
}

/**
 * A trade that asked for its refund this long ago and is still FUNDED was refused when it asked. Long
 * enough that a decision already made has had time to close the trade (the escrow_refunded round
 * trip takes seconds), so the sweep almost never re-asks about a trade that is fine.
 */
export const STRANDED_REFUND_REQUEST_MS = 10 * 60_000;
export const REFUND_REDRIVE_BATCH = 50;

/**
 * The re-drive for a refund request the ledger refused (must-fix from the F-030 review). The request
 * event is consumed whatever the decision says, so a trade that asked while a hold was on it — the
 * hold placed after the seller approved, before the bus delivered the request — would otherwise sit
 * FUNDED, dispatch closed, with its buyer's money in escrow for good. Every five minutes, each such
 * trade with no hold left on it is decided again, in its own transaction, by the same `decideRefund`
 * the event uses: everything it checks it checks again, and a decision already in force answers
 * ALREADY_REFUNDED with nothing written. Nothing is published to the trade, so its parties are not
 * notified a second time. A trade whose books do not match its snapshot is refused again, loudly,
 * every time — that one needs a person, not a retry.
 */
export async function redriveRefundRequests(deps: {
  db: Db;
  logger: Logger;
  now?: Date;
}): Promise<{ redriven: number; refunded: number }> {
  const now = deps.now ?? new Date();
  const stranded = await refundsAwaitingDecision(deps.db, {
    before: new Date(now.getTime() - STRANDED_REFUND_REQUEST_MS),
    limit: REFUND_REDRIVE_BATCH,
  });
  let refunded = 0;
  for (const { tradeId, reason } of stranded) {
    const result = await deps.db.transaction((tx) =>
      decideRefund(tx, { logger: deps.logger }, { tradeId, reason }),
    );
    if (result.outcome === 'REFUNDED') refunded += 1;
    deps.logger.warn({ tradeId, reason, outcome: result.outcome }, 'ledger: re-drove a refund request');
  }
  return { redriven: stranded.length, refunded };
}
