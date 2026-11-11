// Deciding a refund (T-075). A trade asks for its escrow back (`trades.refund.requested`), and the
// ledger decides — once, in one transaction — what goes back, posts it, writes the refund row and
// announces it. The provider call that executes the decision is the dispatch job's
// (`refundDispatch.service.ts`); nothing here touches the network.
//
// What makes it safe to ask twice, or twice at once:
//
//   * the trade is held FOR SHARE, so it cannot transition under the decision, and the charge is held
//     FOR UPDATE, so two decisions against one charge queue and the second sees the first's row;
//   * a whole-trade refund already in force is the answer to a replay (`ALREADY_REFUNDED`), and the
//     partial unique index `refunds_one_live_full` is the backstop;
//   * before anything posts, both of the trade's liabilities must hold exactly what its snapshot says
//     (T-074's check, adopted here as T-074 asked): a refund after a release, or of a trade funded
//     against another snapshot, finds the money is not there and refuses;
//   * migration 0049's trigger refuses cumulative refunds above the charge, whatever this file thinks.
//
// The charge to reverse is the trade's own SUCCEEDED attempt: never anything a client sent (m8 §5).
import { randomUUID } from 'node:crypto';
import { koboToJson, type Kobo } from '@komtru/shared-types';
import { publish, type Tx } from '../../../platform/events/publish.js';
import type { Logger } from '../../../platform/logger.js';
import { paymentEscrowRefundedEvent } from '../domain/events.js';
import {
  planRefund,
  refundIdempotencyKey,
  refundReference,
  RefundRequestError,
  type PlannedRefund,
  type RefundRequestScope,
} from '../domain/refunds.js';
import {
  assertSnapshotMatchesColumns,
  releaseAmounts,
  ReleaseSnapshotError,
  type ReleaseAmounts,
} from '../domain/release.js';
import { accountBalance } from '../infrastructure/postgres/balancesRepository.js';
import {
  findLiveFullRefund,
  insertRefund,
  lockSettledCharge,
} from '../infrastructure/postgres/refundsRepository.js';
import type { PaymentAttemptRow } from '../infrastructure/postgres/schema/payments.js';
import { lockTradeForRefund, type TradeForRefund } from '../infrastructure/postgres/tradeRefund.js';
import { activeTradeHolds } from '../infrastructure/postgres/tradeRelease.js';
import { postJournal } from './journal.service.js';

/**
 * Where a trade may be when its refund is decided. A whole-trade refund answers a post-funding
 * cancellation (CR2 approved, SC1, DE3), which M7 only draws from FUNDED; M7 moves the trade on the
 * strength of the event this posts. A partial refund is a dispute outcome (T-080).
 */
export const REFUNDABLE_STATUSES: Readonly<Record<RefundRequestScope['scope'], readonly string[]>> = {
  FULL: ['FUNDED'],
  PARTIAL: ['DISPUTED'],
};

export interface RefundDeps {
  logger: Logger;
}

export interface RefundInput {
  tradeId: string;
  /** Why: the trade's own word for it (DELIVERY_OVERDUE, SELLER_CANNOT_FULFIL, MUTUAL_AGREEMENT). */
  reason: string;
  /** Defaults to the whole trade. */
  scope?: RefundRequestScope;
  /** 'SYSTEM' unless a person decided it. */
  requestedBy?: string;
  correlationId?: string;
  causationId?: string;
}

export type RefundResult =
  /** Posted, written and announced, in the caller's transaction. */
  | { outcome: 'REFUNDED'; refundId: string; journalEntryId: string; plan: PlannedRefund }
  /** A whole-trade refund is already in force; nothing written, nothing published. */
  | { outcome: 'ALREADY_REFUNDED'; refundId: string }
  /** A hold on the trade blocks it. Nothing written. */
  | { outcome: 'HELD'; holds: string[] }
  /** The trade, its charge or its books are not in a shape where this refund is money. */
  | { outcome: 'NOT_REFUNDABLE'; reason: string };

type Refusal = Extract<RefundResult, { outcome: 'HELD' | 'NOT_REFUNDABLE' }>;

const notRefundable = (reason: string): Refusal => ({ outcome: 'NOT_REFUNDABLE', reason });

/**
 * Decides and posts one refund. Returns rather than throws for every outcome a correctly working
 * system produces — a replay, a hold, a trade that moved on, books that do not match — because the
 * caller is an event subscriber whose only other move is to retry, and none of these are fixed by
 * retrying. A database refusal (the cumulative guard) or a lost connection still throws.
 */
export async function decideRefund(tx: Tx, deps: RefundDeps, input: RefundInput): Promise<RefundResult> {
  const scope: RefundRequestScope = input.scope ?? { scope: 'FULL' };
  const trade = await lockTradeForRefund(tx, input.tradeId);
  if (!trade) return notRefundable('the trade does not exist');
  if (!trade.buyerUserId) return notRefundable('the trade has no buyer to refund');

  const charge = await lockSettledCharge(tx, trade.tradeId);
  if (scope.scope === 'FULL') {
    // Asked under the charge's lock, so a decision racing this one has either committed (and is
    // found) or not started.
    const existing = await findLiveFullRefund(tx, trade.tradeId);
    if (existing) return { outcome: 'ALREADY_REFUNDED', refundId: existing.id };
  }

  const checked = await checkRefundable(tx, trade, charge, scope);
  if ('outcome' in checked) {
    log(deps, trade.tradeId, checked);
    return checked;
  }
  const { amounts, plan, charge: settled, chargeReference } = checked;

  const refundId = randomUUID();
  const posted = await postJournal(tx, {
    idempotencyKey: refundIdempotencyKey(refundId, 'decided'),
    description: `refund decided for trade ${trade.tradeCode}: ${plan.scope.toLowerCase()}, fee ${plan.feeTreatment.toLowerCase()}`,
    currency: amounts.currency,
    tradeId: trade.tradeId,
    provider: settled.provider,
    providerReference: chargeReference,
    lines: plan.lines,
    ...(input.requestedBy ? { createdBy: input.requestedBy } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.causationId ? { causationId: input.causationId } : {}),
  });

  const refund = await insertRefund(tx, {
    id: refundId,
    tradeId: trade.tradeId,
    buyerUserId: trade.buyerUserId,
    paymentAttemptId: settled.id,
    provider: settled.provider,
    chargeReference,
    reference: refundReference(refundId),
    scope: plan.scope,
    reason: input.reason,
    requestedBy: input.requestedBy ?? 'SYSTEM',
    currency: amounts.currency,
    itemAmountMinor: plan.itemAmountMinor,
    feeAmountMinor: plan.feeAmountMinor,
    amountMinor: plan.amountMinor,
    feeTreatment: plan.feeTreatment,
    decisionJournalId: posted.journalEntry.id,
  });

  await publish(tx, paymentEscrowRefundedEvent, {
    aggregateType: 'ledger_refund',
    aggregateId: refund.id,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.causationId ? { causationId: input.causationId } : {}),
    payload: {
      tradeId: trade.tradeId,
      refundId: refund.id,
      journalEntryId: posted.journalEntry.id,
      buyerUserId: trade.buyerUserId,
      reason: input.reason,
      scope: plan.scope,
      currency: amounts.currency,
      itemAmountMinor: koboToJson(plan.itemAmountMinor),
      feeAmountMinor: koboToJson(plan.feeAmountMinor),
      amountMinor: koboToJson(plan.amountMinor),
      buyerProtectionFeeTreatment: plan.feeTreatment,
      refundedAt: posted.journalEntry.postedAt.toISOString(),
    },
  });

  return { outcome: 'REFUNDED', refundId: refund.id, journalEntryId: posted.journalEntry.id, plan };
}

interface Refundable {
  amounts: ReleaseAmounts;
  plan: PlannedRefund;
  charge: PaymentAttemptRow;
  chargeReference: string;
}

/** Everything that must be true before money moves. Returns the refusal, or what to post. */
async function checkRefundable(
  tx: Tx,
  trade: TradeForRefund,
  charge: PaymentAttemptRow | undefined,
  scope: RefundRequestScope,
): Promise<Refusal | Refundable> {
  // Holds first: a held trade is not a broken one, and must not be reported as one.
  const holds = await activeTradeHolds(tx, trade.tradeId);
  if (holds.length) return { outcome: 'HELD', holds };

  const allowed = REFUNDABLE_STATUSES[scope.scope];
  if (!allowed.includes(trade.status)) {
    return notRefundable(`the trade is ${trade.status}, not ${allowed.join(' or ')}`);
  }
  if (!charge) return notRefundable('the trade has no settled charge to refund');
  const chargeReference = charge.providerReference;
  if (!chargeReference) return notRefundable('the settled charge has no provider reference');

  let amounts: ReleaseAmounts;
  let plan: PlannedRefund;
  try {
    amounts = releaseAmounts(trade);
    assertSnapshotMatchesColumns(amounts);
    plan = planRefund(trade.tradeId, amounts, scope);
  } catch (error) {
    if (error instanceof ReleaseSnapshotError || error instanceof RefundRequestError) {
      return notRefundable(error.detail);
    }
    throw error;
  }

  // The charge was copied from the same snapshot at initiation (T-072). A difference means the money
  // the provider holds is not the money this plan would return.
  if (
    charge.currency !== amounts.currency ||
    charge.itemAmountMinor !== amounts.itemAmountMinor ||
    charge.buyerProtectionFeeMinor !== amounts.buyerProtectionFeeMinor
  ) {
    return notRefundable("the settled charge's amounts are not the trade's snapshot");
  }

  // The ledger's own books, read inside this transaction. A whole-trade refund needs both liabilities
  // exactly as funded; a partial one needs at least its share still in escrow.
  const escrow = await balanceOf(
    tx,
    { type: 'USER_ESCROW_LIABILITY', tradeId: trade.tradeId },
    amounts.currency,
  );
  const fee = await balanceOf(
    tx,
    { type: 'BUYER_PROTECTION_FEE_LIABILITY', tradeId: trade.tradeId },
    amounts.currency,
  );
  if (plan.scope === 'FULL') {
    if (escrow !== amounts.itemAmountMinor) {
      return notRefundable(
        `escrow holds ${escrow} for this trade, not the snapshotted item ${amounts.itemAmountMinor}`,
      );
    }
    if (fee !== amounts.buyerProtectionFeeMinor) {
      return notRefundable(
        `the protection fee liability holds ${fee}, not the snapshotted fee ${amounts.buyerProtectionFeeMinor}`,
      );
    }
  } else if (escrow < plan.itemAmountMinor) {
    return notRefundable(
      `escrow holds ${escrow} for this trade, less than the ${plan.itemAmountMinor} asked`,
    );
  }

  return { amounts, plan, charge, chargeReference };
}

const balanceOf = async (
  tx: Tx,
  account: Parameters<typeof accountBalance>[1],
  currency: string,
): Promise<Kobo> => (await accountBalance(tx, account, currency)).balanceMinor;

function log(deps: RefundDeps, tradeId: string, refusal: Refusal): void {
  if (refusal.outcome === 'HELD') {
    deps.logger.warn({ tradeId, holds: refusal.holds }, 'ledger: refund blocked by a hold on the trade');
  } else {
    deps.logger.error(
      { tradeId, reason: refusal.reason },
      'ledger: a refund was asked for that is not money',
    );
  }
}
