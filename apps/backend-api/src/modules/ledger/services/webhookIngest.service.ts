// Provider webhooks in, ledger postings out (m8 §8). The only place a provider event becomes money.
//
// Two halves. `recordWebhook` is the request side: signature first, then the dedup insert, then a
// job — no provider call and no posting while Paystack waits for its 200. `settleCharge` is the job
// side: it runs on the verify call's answer, never on the webhook's, and posts at most once however
// many times it is asked.
//
// "At most once" is held three deep. The dedup index means a replayed delivery queues no second
// job. The attempt row is locked FOR UPDATE and a settled attempt is final (migration 0040), so a
// second verify of the same charge — a replay, the buyer's confirm racing the webhook, a retried job
// — finds it SUCCEEDED and stops. And the journal key `charge:<reference>` means even a raced second
// posting writes nothing and announces nothing.
import { koboToJson } from '@komtru/shared-types';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import type { Logger } from '../../../platform/logger.js';
import { paymentEscrowFundedEvent, paymentReviewRequiredEvent } from '../domain/events.js';
import {
  assessVerifiedCharge,
  fundingIdempotencyKey,
  fundingJournalLines,
  isFundingReference,
  isOpenAttempt,
  type VerifiedChargeView,
  type VerifyOutcome,
} from '../domain/funding.js';
import type { PaymentProviderAdapter } from '../domain/providerAdapter.js';
import { paystackEventId } from '../infrastructure/providers/paystack/eventId.js';
import {
  findDelivery,
  lockAttemptByReference,
  markDeliveryProcessed,
  recordDelivery,
  updatePaymentAttempt,
} from '../infrastructure/postgres/paymentsRepository.js';
import type { PaymentAttemptRow } from '../infrastructure/postgres/schema/payments.js';
import { shareLockTradeStatus } from '../infrastructure/postgres/tradeFunding.js';
import { postJournal } from './journal.service.js';

// ---------------------------------------------------------------------------------------------
// The request side
// ---------------------------------------------------------------------------------------------

export interface RecordWebhookDeps {
  db: Db;
  adapter: Pick<PaymentProviderAdapter, 'code' | 'verifyWebhookSignature'>;
  /** Queues the processing job for one stored delivery. */
  enqueueDelivery: (webhookId: bigint) => Promise<void>;
  logger: Logger;
}

export type RecordWebhookResult =
  | { outcome: 'queued'; webhookId: bigint }
  | { outcome: 'duplicate'; webhookId: bigint }
  | { outcome: 'unreadable' };

/**
 * `POST /webhooks/paystack`. Throws 401 for a bad signature, before anything is stored (M8 §11);
 * otherwise always succeeds, because Paystack retries every non-2xx for 72 hours and a delivery we
 * have on file is better processed by our sweep than by Paystack's retry.
 */
export async function recordWebhook(
  deps: RecordWebhookDeps,
  rawBody: Buffer,
  signature: string | undefined,
): Promise<RecordWebhookResult> {
  if (!deps.adapter.verifyWebhookSignature(rawBody, signature)) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'The webhook signature is not valid');
  }

  const providerEventId = paystackEventId(rawBody);
  if (providerEventId === null) {
    // Signed, so it is Paystack's; unreadable, so there is nothing to store or act on. Refusing it
    // would only make Paystack send the same bytes for three days.
    deps.logger.warn('ledger: a signed webhook is not a readable event envelope');
    return { outcome: 'unreadable' };
  }
  const payload = JSON.parse(rawBody.toString('utf8')) as { event: string };

  const delivery = await recordDelivery(deps.db, {
    provider: deps.adapter.code,
    providerEventId,
    eventType: payload.event,
    payload,
  });

  if (!delivery.inserted && delivery.processed) return { outcome: 'duplicate', webhookId: delivery.id };
  // New, or on file but never processed (the first enqueue may have failed): queue it. The job id
  // is the row's, so this cannot become a second job while the first is still waiting.
  try {
    await deps.enqueueDelivery(delivery.id);
  } catch (error) {
    // The row is stored; the sweep re-queues it. Paystack still gets its 200.
    deps.logger.error({ err: error, webhookId: String(delivery.id) }, 'ledger: webhook enqueue failed');
  }
  return delivery.inserted
    ? { outcome: 'queued', webhookId: delivery.id }
    : { outcome: 'duplicate', webhookId: delivery.id };
}

// ---------------------------------------------------------------------------------------------
// The job side
// ---------------------------------------------------------------------------------------------

export interface SettleDeps {
  db: Db;
  logger: Logger;
}

export type SettleResult = VerifyOutcome | { kind: 'UNKNOWN_REFERENCE' };

/** A verify that has not reached a final answer; thrown after commit so the queue retries it. */
export class ChargeStillPendingError extends Error {
  constructor(
    readonly reference: string,
    readonly providerStatus: string,
  ) {
    super(`charge ${reference} is still ${providerStatus}`);
    this.name = 'ChargeStillPendingError';
  }
}

const verifiedColumns = (verified: VerifiedChargeView, now: Date) => ({
  lastProviderStatus: verified.status,
  lastVerifiedAt: now,
  verifiedAmountMinor: Number.isSafeInteger(verified.amountMinor) ? BigInt(verified.amountMinor) : null,
  verifiedCurrency: verified.currency,
});

async function requireReview(
  tx: Tx,
  attempt: PaymentAttemptRow,
  verified: VerifiedChargeView,
  reason: string,
  now: Date,
): Promise<void> {
  // An open attempt is closed for review. A closed one cannot change (it is final), so the event is
  // the whole record: money arrived on a reference nobody is waiting on any more.
  if (isOpenAttempt(attempt.status)) {
    await updatePaymentAttempt(tx, attempt.id, {
      ...verifiedColumns(verified, now),
      status: 'NEEDS_REVIEW',
      closedAt: now,
      failureReason: reason,
    });
  }
  await publish(tx, paymentReviewRequiredEvent, {
    aggregateType: 'ledger_payment_attempt',
    aggregateId: attempt.id,
    payload: {
      tradeId: attempt.tradeId,
      paymentAttemptId: attempt.id,
      provider: attempt.provider,
      reference: attempt.reference,
      reason,
      providerStatus: verified.status,
      verifiedAmountMinor: Number.isSafeInteger(verified.amountMinor) ? String(verified.amountMinor) : null,
      verifiedCurrency: verified.currency,
      dueAmountMinor: koboToJson(attempt.amountMinor),
    },
  });
}

async function postFunding(
  tx: Tx,
  attempt: PaymentAttemptRow,
  verified: VerifiedChargeView,
  now: Date,
): Promise<void> {
  const amounts = {
    currency: attempt.currency,
    feeScheduleVersion: attempt.feeScheduleVersion,
    itemAmountMinor: attempt.itemAmountMinor,
    buyerProtectionFeeMinor: attempt.buyerProtectionFeeMinor,
    totalMinor: attempt.amountMinor,
  };
  const posted = await postJournal(tx, {
    idempotencyKey: fundingIdempotencyKey(attempt.reference),
    description: `escrow funded for trade ${attempt.tradeId}`,
    currency: attempt.currency,
    tradeId: attempt.tradeId,
    provider: attempt.provider,
    providerReference: verified.reference,
    lines: fundingJournalLines(attempt.tradeId, amounts),
  });

  await updatePaymentAttempt(tx, attempt.id, {
    ...verifiedColumns(verified, now),
    status: 'SUCCEEDED',
    providerReference: verified.reference,
    journalEntryId: posted.journalEntry.id,
    confirmedAt: now,
  });

  // Only the posting that wrote the journal announces it. `posted: false` here would mean another
  // transaction posted this charge without marking the attempt, which the lock rules out; staying
  // silent is still the right answer, because that transaction published.
  if (!posted.posted) return;
  await publish(tx, paymentEscrowFundedEvent, {
    aggregateType: 'ledger_payment_attempt',
    aggregateId: attempt.id,
    payload: {
      tradeId: attempt.tradeId,
      paymentAttemptId: attempt.id,
      journalEntryId: posted.journalEntry.id,
      provider: attempt.provider,
      reference: attempt.reference,
      currency: attempt.currency,
      amountMinor: koboToJson(attempt.amountMinor),
      itemAmountMinor: koboToJson(attempt.itemAmountMinor),
      buyerProtectionFeeMinor: koboToJson(attempt.buyerProtectionFeeMinor),
      fundedAt: now.toISOString(),
    },
  });
}

/**
 * Applies one verified answer to the attempt it is about, in one transaction under the attempt's
 * row lock. Throws `ChargeStillPendingError` (after committing what it learned) when the provider has
 * not decided yet, so the queue's backoff asks again.
 */
export async function settleCharge(
  deps: SettleDeps,
  reference: string,
  verified: VerifiedChargeView,
): Promise<SettleResult> {
  const now = new Date();
  const result = await deps.db.transaction(async (tx): Promise<SettleResult> => {
    const attempt = await lockAttemptByReference(tx, reference);
    if (!attempt) return { kind: 'UNKNOWN_REFERENCE' };

    let outcome = assessVerifiedCharge(attempt, verified);
    if (outcome.kind === 'POST') {
      // Money for a trade that is no longer waiting for it (cancelled, expired) is not escrow: it
      // goes to review and is refunded from there, never posted against a trade M7 cannot fund.
      const status = await shareLockTradeStatus(tx, attempt.tradeId);
      if (status !== 'PENDING_PAYMENT') {
        outcome = {
          kind: 'NEEDS_REVIEW',
          reason: `the trade is ${status ?? 'missing'}, not awaiting payment`,
        };
      }
    }

    switch (outcome.kind) {
      case 'POST':
        await postFunding(tx, attempt, verified, now);
        break;
      case 'NEEDS_REVIEW':
        await requireReview(tx, attempt, verified, outcome.reason, now);
        break;
      case 'NOT_CONFIRMED':
      case 'PENDING':
        await updatePaymentAttempt(tx, attempt.id, {
          ...verifiedColumns(verified, now),
          ...(attempt.status === 'INITIATED' ? { status: 'PENDING' as const, pendingAt: now } : {}),
        });
        break;
      case 'NO_OP':
        break;
    }
    return outcome;
  });

  if (result.kind === 'NEEDS_REVIEW') {
    deps.logger.warn({ reference, reason: result.reason }, 'ledger: verified charge held for review');
  }
  if (result.kind === 'PENDING') throw new ChargeStillPendingError(reference, result.providerStatus);
  return result;
}

/** What processing a stored delivery needs: the verify call, and somewhere to settle its answer. */
export interface ProcessDeliveryDeps extends SettleDeps {
  /** The provider's transaction verify call (`verifyCharge` in paystack/client.ts). */
  verify: (reference: string) => Promise<VerifiedChargeView>;
  parse: PaymentProviderAdapter['parseWebhookEvent'];
}

/**
 * The job behind `POST /webhooks/paystack`. Charge events are re-verified and settled; transfer and
 * refund events are recorded and left for T-073 and T-075, which have nothing in flight to match
 * them against yet. A delivery is marked processed only once its outcome is committed.
 */
export async function processDelivery(deps: ProcessDeliveryDeps, webhookId: bigint): Promise<string> {
  const delivery = await findDelivery(deps.db, webhookId);
  if (!delivery) return 'missing';
  if (delivery.processedAt) return 'already processed';

  let event;
  try {
    event = deps.parse(Buffer.from(JSON.stringify(delivery.payload), 'utf8'));
  } catch (error) {
    const detail = error instanceof ApiError ? (error.detail ?? error.title) : 'unparseable';
    await markDeliveryProcessed(deps.db, webhookId, `unreadable: ${detail}`);
    return 'unreadable';
  }

  if (!event) {
    await markDeliveryProcessed(deps.db, webhookId, `ignored: ${delivery.eventType} is not acted on`);
    return 'ignored';
  }
  if (event.type !== 'charge.succeeded' && event.type !== 'charge.failed') {
    await markDeliveryProcessed(deps.db, webhookId, `ignored: ${event.type} has no handler yet`);
    return 'ignored';
  }

  if (!isFundingReference(event.reference)) {
    // Not a checkout this module issued, so there is nothing to verify it against.
    await markDeliveryProcessed(deps.db, webhookId, 'unknown reference');
    return 'UNKNOWN_REFERENCE';
  }

  // A ChargeStillPendingError leaves the delivery unprocessed: the retry asks again.
  const verified = await deps.verify(event.reference);
  const outcome = await settleCharge(deps, event.reference, verified);
  await markDeliveryProcessed(
    deps.db,
    webhookId,
    outcome.kind === 'UNKNOWN_REFERENCE' ? 'unknown reference' : null,
  );
  return outcome.kind;
}
