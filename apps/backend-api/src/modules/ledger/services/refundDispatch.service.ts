// Sending a refund and finding out what became of it (T-075). The only place `initiateRefund` is
// called, and the only place a refund reaches an outcome.
//
// The rules that carry the money, after the payout pattern (F-037) with one difference that matters:
//
//   * a refund is claimed REQUESTED → PROCESSING, under its row lock, BEFORE the provider is asked. A
//     second dispatch finds it PROCESSING and only ever resolves it.
//   * an outcome is settled on the provider's own record of the refund (`GET /refund/:id`), never on a
//     webhook body and never on the initiate call's own status.
//   * THE DIFFERENCE: Paystack's Refund API accepts no reference of ours, so a call that fails or times
//     out cannot be checked by reference the way a transfer can — and sending it again might refund
//     the buyer twice. An unanswered initiate is therefore NEVER re-sent. The refund stays PROCESSING
//     with no provider id until a `refund.*` webhook names it (`attachProviderRefund`), and past an hour
//     it is handed to a person (NEEDS_REVIEW). The decision journal has already posted, so the buyer's
//     money is accounted for either way; what waits is only the execution.
//
// FAILED posts `refund:<id>:failed` and the status only moves forward (migration 0049), so a replayed
// webhook, a retried job and the sweep can all arrive at once and the money still moves once.
import { koboToJson } from '@komtru/shared-types';
import type { Db } from '../../../db/index.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import type { Logger } from '../../../platform/logger.js';
import { refundCompletedEvent, type REFUND_OUTCOMES } from '../domain/events.js';
import type { InitiateRefundInput, InitiateRefundResult } from '../domain/providerAdapter.js';
import {
  describeRefundMismatch,
  refundFailureLines,
  refundIdempotencyKey,
  RefundNotFoundError,
  refundOutcome,
  type VerifiedRefundView,
} from '../domain/refunds.js';
import {
  findRefund,
  findRefundByProviderId,
  lockRefund,
  unnamedRefundsForCharge,
  updateRefund,
  type RefundChange,
} from '../infrastructure/postgres/refundsRepository.js';
import type { RefundRow, RefundStatus } from '../infrastructure/postgres/schema/refunds.js';
import { lockTradeShare } from '../infrastructure/postgres/tradeRefund.js';
import { activeTradeHolds } from '../infrastructure/postgres/tradeRelease.js';
import { postJournal } from './journal.service.js';

export interface RefundDispatchDeps {
  db: Db;
  logger: Logger;
  initiateRefund: (input: InitiateRefundInput) => Promise<InitiateRefundResult>;
  verifyRefund: (providerRefundId: string) => Promise<VerifiedRefundView>;
  now?: () => Date;
}

const clock = (deps: Pick<RefundDispatchDeps, 'now'>): Date => deps.now?.() ?? new Date();

/** Thrown after commit while the provider has not decided, so the queue's poll asks again. */
export class RefundStillPendingError extends Error {
  constructor(
    readonly refundId: string,
    readonly providerStatus: string,
  ) {
    super(`refund ${refundId} is still ${providerStatus}`);
    this.name = 'RefundStillPendingError';
  }
}

/** Paystack documents no bound on a refund's journey; past a week a person looks (owner question 5). */
export const MAX_PENDING_MS = 7 * 24 * 60 * 60_000;
/** An initiate with no answer and no webhook naming it after this long is handed to a person. */
export const UNNAMED_MS = 60 * 60_000;

/** Words a buyer can read. Never a provider payload. */
export const FAILED_REASON =
  'The payment provider could not return this refund to your payment method. Our team will contact you to arrange it.';
export const REVIEW_REASON =
  "The payment provider's record of this refund does not match it; our team is checking.";
export const STUCK_REASON =
  'The payment provider has not finished this refund within 7 days; our team is checking.';
export const UNANSWERED_REASON =
  'The payment provider has not confirmed it received this refund; our team is checking.';

type Outcome = (typeof REFUND_OUTCOMES)[number];

export type RefundProgress = RefundStatus | 'MISSING';

async function announce(
  tx: Tx,
  refund: RefundRow,
  outcome: Outcome,
  journalEntryId: string | null,
  reason: string | null,
  now: Date,
): Promise<void> {
  await publish(tx, refundCompletedEvent, {
    aggregateType: 'ledger_refund',
    aggregateId: refund.id,
    payload: {
      refundId: refund.id,
      tradeId: refund.tradeId,
      buyerUserId: refund.buyerUserId,
      outcome,
      currency: refund.currency,
      amountMinor: koboToJson(refund.amountMinor),
      journalEntryId,
      reason,
      completedAt: now.toISOString(),
    },
  });
}

/** Hands a refund to a person. Nothing posts: the decision stands until ops says otherwise. */
async function toReview(
  tx: Tx,
  refund: RefundRow,
  reason: string,
  now: Date,
  extra: RefundChange = {},
): Promise<RefundRow> {
  const row = await updateRefund(tx, refund.id, { ...extra, status: 'NEEDS_REVIEW', failureReason: reason });
  await announce(tx, row, 'NEEDS_REVIEW', null, reason, now);
  return row;
}

type Claim =
  | { kind: 'CLAIMED'; refund: RefundRow }
  | { kind: 'NOT_REQUESTED'; refund: RefundRow }
  | { kind: 'HELD'; refund: RefundRow; holds: string[] };

/**
 * REQUESTED → PROCESSING under the row lock, before the provider hears of it — and only while nothing
 * holds the trade. The decision checked for holds when it posted, but a hold placed since (a fraud or
 * compliance review on a cancelled trade) must still stop the money leaving. The trade is read FOR
 * SHARE first, the lock every hold writer must wait on (`activeTradeHolds`), so a hold either commits
 * before this check and is seen, or waits until the claim has committed. A held refund stays REQUESTED
 * and the sweep asks again once the hold is lifted.
 */
async function claim(deps: RefundDispatchDeps, refundId: string): Promise<Claim | undefined> {
  const now = clock(deps);
  return deps.db.transaction(async (tx): Promise<Claim | undefined> => {
    const seen = await findRefund(tx, refundId);
    if (!seen) return undefined;
    if (seen.status !== 'REQUESTED') return { kind: 'NOT_REQUESTED', refund: seen };
    await lockTradeShare(tx, seen.tradeId);
    const refund = await lockRefund(tx, refundId);
    if (!refund) return undefined;
    if (refund.status !== 'REQUESTED') return { kind: 'NOT_REQUESTED', refund };
    const holds = await activeTradeHolds(tx, refund.tradeId);
    if (holds.length) return { kind: 'HELD', refund, holds };
    return {
      kind: 'CLAIMED',
      refund: await updateRefund(tx, refund.id, { status: 'PROCESSING', dispatchedAt: now }),
    };
  });
}

/** A short, payload-free reason for a failed provider call. */
const errorSummary = (error: unknown): string => {
  if (error instanceof Error) {
    const detail = (error as { detail?: unknown }).detail;
    return `${error.name}${typeof detail === 'string' ? `: ${detail}` : ''}`.slice(0, 300);
  }
  return 'unknown error';
};

/**
 * Asks the provider once. A throw is recorded and swallowed, deliberately: the queue must not retry
 * this call (see the header). A refund the provider answered for records its id, the one thing every
 * later step correlates on.
 */
async function send(deps: RefundDispatchDeps, refund: RefundRow): Promise<void> {
  const amount = Number(refund.amountMinor);
  if (!Number.isSafeInteger(amount)) throw new Error(`ledger: refund ${refund.id} is too large to send`);
  let result: InitiateRefundResult;
  try {
    result = await deps.initiateRefund({
      chargeProviderReference: refund.chargeReference,
      amountMinor: amount,
      reference: refund.reference,
      reason: 'Komtru refund',
    });
  } catch (error) {
    const summary = errorSummary(error);
    deps.logger.error(
      { refundId: refund.id, error: summary },
      'ledger: refund initiate failed or went unanswered; it will not be re-sent',
    );
    await deps.db.transaction(async (tx) => {
      const locked = await lockRefund(tx, refund.id);
      if (locked?.status !== 'PROCESSING') return;
      await updateRefund(tx, refund.id, { lastError: summary, lastErrorAt: clock(deps) });
    });
    return;
  }
  await deps.db.transaction(async (tx) => {
    const locked = await lockRefund(tx, refund.id);
    if (locked?.status !== 'PROCESSING') return;
    await updateRefund(tx, refund.id, {
      ...(locked.providerRefundId ? {} : { providerRefundId: result.providerRefundId }),
      lastProviderStatus: result.status,
      lastCheckedAt: clock(deps),
    });
  });
}

/**
 * The dispatch job (`ledger.process-refund`): claims a REQUESTED refund and sends it, then resolves
 * it on the provider's record. A held trade's refund is left REQUESTED and unsent; the sweep
 * re-queues it, since its row does not change. A PROCESSING one is only resolved — never sent
 * again. Throws `RefundStillPendingError` while the provider has not decided.
 */
export async function processRefund(deps: RefundDispatchDeps, refundId: string): Promise<RefundProgress> {
  const claimed = await claim(deps, refundId);
  if (!claimed) return 'MISSING';
  if (claimed.kind === 'HELD') {
    deps.logger.warn(
      { refundId, tradeId: claimed.refund.tradeId, holds: claimed.holds },
      'ledger: refund not sent while the trade is held; the sweep asks again',
    );
    return 'REQUESTED';
  }
  if (claimed.kind === 'CLAIMED') await send(deps, claimed.refund);
  else if (claimed.refund.status !== 'PROCESSING') return claimed.refund.status;
  return resolveRefund(deps, refundId);
}

/**
 * Settles a PROCESSING refund on the provider's record. Called by the dispatch job, the `refund.*`
 * webhook and the sweep. Every other status is final here: PROCESSED and FAILED for good, and
 * NEEDS_REVIEW until a person decides (T-076).
 */
export async function resolveRefund(deps: RefundDispatchDeps, refundId: string): Promise<RefundProgress> {
  const refund = await findRefund(deps.db, refundId);
  if (!refund) return 'MISSING';
  if (refund.status !== 'PROCESSING') return refund.status;

  if (!refund.providerRefundId) {
    const now = clock(deps);
    const since = refund.dispatchedAt ?? refund.requestedAt;
    if (now.getTime() - since.getTime() < UNNAMED_MS) return 'PROCESSING';
    return deps.db.transaction(async (tx) => {
      const locked = await lockRefund(tx, refundId);
      if (locked?.status !== 'PROCESSING' || locked.providerRefundId) return locked?.status ?? 'MISSING';
      deps.logger.error({ refundId }, 'ledger: a refund the provider never named is held for review');
      return (await toReview(tx, locked, UNANSWERED_REASON, now)).status;
    });
  }

  let verified: VerifiedRefundView | undefined;
  let notFound = false;
  try {
    verified = await deps.verifyRefund(refund.providerRefundId);
  } catch (error) {
    if (!(error instanceof RefundNotFoundError)) throw error;
    notFound = true;
  }

  const now = clock(deps);
  const result = await deps.db.transaction(
    async (tx): Promise<{ status: RefundProgress; pending?: string }> => {
      const locked = await lockRefund(tx, refundId);
      if (!locked) return { status: 'MISSING' };
      if (locked.status !== 'PROCESSING') return { status: locked.status };

      if (notFound || !verified) {
        // The id came from the provider itself, so "no such refund" is not proof of anything.
        deps.logger.error({ refundId }, 'ledger: the provider has no record of a refund it named');
        return { status: (await toReview(tx, locked, REVIEW_REASON, now)).status };
      }
      const seen: RefundChange = { lastProviderStatus: verified.status, lastCheckedAt: now };

      const mismatch = describeRefundMismatch(locked, verified);
      if (mismatch) {
        // The provider's figures stay in the log, for ops; the event carries words anyone may see.
        deps.logger.error({ refundId, mismatch }, 'ledger: the provider’s refund does not match ours');
        return { status: (await toReview(tx, locked, REVIEW_REASON, now, seen)).status };
      }

      switch (refundOutcome(verified.status)) {
        case 'PROCESSED': {
          const row = await updateRefund(tx, locked.id, { ...seen, status: 'PROCESSED', completedAt: now });
          await announce(tx, row, 'PROCESSED', null, null, now);
          return { status: 'PROCESSED' };
        }
        case 'FAILED': {
          // Paystack has put the money back in our balance and the buyer was not paid (m8 §3): the
          // pool holds it again, and the trade owes it again.
          const posted = await postJournal(tx, {
            idempotencyKey: refundIdempotencyKey(locked.id, 'failed'),
            description: `refund ${locked.reference} failed at the provider`,
            currency: locked.currency,
            tradeId: locked.tradeId,
            provider: locked.provider,
            providerReference: locked.chargeReference,
            lines: refundFailureLines(locked.tradeId, locked),
          });
          const row = await updateRefund(tx, locked.id, {
            ...seen,
            status: 'FAILED',
            failedJournalId: posted.journalEntry.id,
            failedAt: now,
            failureReason: FAILED_REASON,
          });
          await announce(tx, row, 'FAILED', posted.journalEntry.id, FAILED_REASON, now);
          deps.logger.error(
            { refundId },
            'ledger: a refund failed at the provider; the money is back in escrow',
          );
          return { status: 'FAILED' };
        }
        case 'PENDING': {
          const since = locked.dispatchedAt ?? locked.requestedAt;
          if (now.getTime() - since.getTime() >= MAX_PENDING_MS) {
            deps.logger.error(
              { refundId, status: verified.status },
              'ledger: refund pending too long, held for review',
            );
            return { status: (await toReview(tx, locked, STUCK_REASON, now, seen)).status };
          }
          await updateRefund(tx, locked.id, seen);
          return { status: 'PROCESSING', pending: verified.status };
        }
      }
    },
  );

  if (result.pending !== undefined) throw new RefundStillPendingError(refundId, result.pending);
  return result.status;
}

/**
 * Which refund a `refund.*` webhook is about. By the provider's refund id first; failing that, by the
 * original charge's reference — but only when exactly one in-flight refund against that charge is still
 * waiting to be named, because an initiate whose answer was lost leaves exactly that. Two candidates,
 * or none, and nothing is guessed.
 *
 * A charge can carry a refund that is not ours — one made by hand on the provider's dashboard, say —
 * and the provider refund id can be set only once (migration 0049), so attaching the wrong one would
 * leave our own refund unable to be named when its webhook comes. The provider's record of the named
 * refund is therefore read first, and the id is attached only when it is for this refund's amount and
 * currency. Anything else is left unattached and logged; our refund keeps waiting for its own name,
 * and past an hour goes to a person as before.
 */
export async function attachProviderRefund(
  deps: Pick<RefundDispatchDeps, 'db' | 'logger' | 'verifyRefund'>,
  event: { provider: RefundRow['provider']; chargeReference: string; providerRefundId: string },
): Promise<string | undefined> {
  const named = await findRefundByProviderId(deps.db, event.provider, event.providerRefundId);
  if (named) return named.id;
  const candidates = await unnamedRefundsForCharge(deps.db, event.provider, event.chargeReference);
  if (candidates.length !== 1 || !candidates[0]) {
    if (candidates.length > 1) {
      deps.logger.error(
        { chargeReference: event.chargeReference, candidates: candidates.length },
        'ledger: a refund webhook matches more than one unnamed refund; left for review',
      );
    }
    return undefined;
  }
  const candidate = candidates[0];

  let record: VerifiedRefundView;
  try {
    record = await deps.verifyRefund(event.providerRefundId);
  } catch (error) {
    if (!(error instanceof RefundNotFoundError)) throw error;
    deps.logger.warn(
      { refundId: candidate.id },
      'ledger: a refund webhook named a refund the provider does not have',
    );
    return undefined;
  }
  // `providerRefundId: null`: the candidate has no name yet, so only the money is compared.
  const mismatch = describeRefundMismatch({ ...candidate, providerRefundId: null }, record);
  if (mismatch) {
    deps.logger.warn(
      { refundId: candidate.id, mismatch },
      'ledger: a refund webhook on this charge is for another refund; not attached',
    );
    return undefined;
  }

  return deps.db.transaction(async (tx) => {
    const locked = await lockRefund(tx, candidate.id);
    if (!locked || locked.status !== 'PROCESSING' || locked.providerRefundId)
      return locked?.providerRefundId === event.providerRefundId ? locked.id : undefined;
    await updateRefund(tx, locked.id, { providerRefundId: event.providerRefundId });
    deps.logger.warn(
      { refundId: locked.id },
      'ledger: a refund webhook named a refund whose initiate went unanswered',
    );
    return locked.id;
  });
}

/**
 * The `refund.*` webhook's handler: find the refund, then resolve it on the provider's record. A refund
 * the provider is still working on is left to the dispatch job's poll and the sweep — refunds can take
 * days, and holding the delivery open for that long would only burn its retries.
 */
export async function resolveRefundEvent(
  deps: RefundDispatchDeps,
  event: { provider: RefundRow['provider']; chargeReference: string; providerRefundId: string },
): Promise<RefundProgress> {
  const refundId = await attachProviderRefund(deps, event);
  if (!refundId) return 'MISSING';
  try {
    return await resolveRefund(deps, refundId);
  } catch (error) {
    if (error instanceof RefundStillPendingError) return 'PROCESSING';
    throw error;
  }
}
