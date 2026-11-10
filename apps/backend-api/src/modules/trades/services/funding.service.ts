// F-024: the ledger's answer to a buyer paying. The ledger never moves a trade (T-072); it publishes
// `ledger.payment.escrow_funded` once the charge is verified and posted, and this is where the trade follows.
import { eq } from 'drizzle-orm';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { tradeFundingReviewRequiredEvent } from '../domain/ledgerEvents.js';
import { FUNDED_OR_LATER } from '../domain/stateMachine.js';
import { trades } from '../infrastructure/postgres/schema/trades.js';
import { applyTransition } from '../infrastructure/postgres/transitions.js';
import { recordActivity } from './trade.service.js';

export type FundOutcome = 'FUNDED' | 'ALREADY_FUNDED' | 'UNKNOWN_TRADE' | 'IGNORED' | 'AMOUNT_MISMATCH';

export interface FundInput {
  tradeId: string;
  paymentAttemptId: string;
  journalEntryId: string;
  reference: string;
  currency: string;
  amountMinor: string;
}

// Activity rows reuse the existing `ESCROW_ACTION_SETTLED` label and say what happened in `metadata.event`
// (`ESCROW_FUNDED`, `ESCROW_FUNDING_REVIEW`). A dedicated enum label would need `ALTER TYPE … ADD VALUE`,
// which every migration since T-072 avoids (the migrator runs pending migrations in one transaction). Readers
// key on `metadata.event`, as the party activity feed already does with its allowlist; neither event is on
// it, so these rows are internal.
const FUNDED_EVENT = 'ESCROW_FUNDED';
const REVIEW_EVENT = 'ESCROW_FUNDING_REVIEW';

/**
 * `ledger.payment.escrow_funded`: `PENDING_PAYMENT -> FUNDED`, as the ledger. Runs in the event's own
 * transaction, so the transition and the claim on the event commit together, and the state change it
 * publishes is what opens the delivery deadline, tells the seller and pushes to both workspace tabs.
 *
 * Never throws for a trade it should not move, because a retried event would fail the same way. A trade
 * already funded is a no-op. Money the trade will not take — the trade ended before the event arrived, does not
 * exist, or the amount or currency is not its snapshotted buyer total — is escrowed all the same, so it is
 * recorded durably for review (`trades.funding.review_required`, and an internal activity row when there is a
 * trade) and never refunded automatically (T-072 decision 8). A hold does not stop funding: like the settle, it
 * records money that has already moved.
 */
export async function fundTrade(tx: Tx, input: FundInput): Promise<FundOutcome> {
  const [trade] = await tx.select().from(trades).where(eq(trades.id, input.tradeId)).for('update');
  const money = {
    paymentAttemptId: input.paymentAttemptId,
    journalEntryId: input.journalEntryId,
    reference: input.reference,
  };
  if (!trade) {
    await review(tx, input, 'UNKNOWN_TRADE', null, null);
    return 'UNKNOWN_TRADE';
  }
  if (FUNDED_OR_LATER.has(trade.status)) return 'ALREADY_FUNDED';
  const expected = trade.buyerTotalMinor === null ? null : trade.buyerTotalMinor.toString();
  if (trade.status !== 'PENDING_PAYMENT') {
    await review(tx, input, 'TRADE_NOT_AWAITING_PAYMENT', trade.status, expected);
    return 'IGNORED';
  }
  if (expected !== input.amountMinor || trade.currency !== input.currency) {
    await review(tx, input, 'AMOUNT_MISMATCH', trade.status, expected);
    return 'AMOUNT_MISMATCH';
  }
  await applyTransition(tx, {
    tradeId: trade.id,
    action: 'FUND',
    to: 'FUNDED',
    actor: { type: 'LEDGER' },
    reason: 'ESCROW_FUNDED',
    context: money,
  });
  await recordActivity(tx, {
    tradeId: trade.id,
    type: 'ESCROW_ACTION_SETTLED',
    actorType: 'SYSTEM',
    summary: "The ledger confirmed the buyer's payment; the funds are held in escrow",
    metadata: { event: FUNDED_EVENT, ...money },
  });
  return 'FUNDED';
}

async function review(
  tx: Tx,
  input: FundInput,
  reason: 'TRADE_NOT_AWAITING_PAYMENT' | 'UNKNOWN_TRADE' | 'AMOUNT_MISMATCH',
  tradeStatus: string | null,
  expectedAmountMinor: string | null,
): Promise<void> {
  await publish(tx, tradeFundingReviewRequiredEvent, {
    payload: {
      tradeId: input.tradeId,
      paymentAttemptId: input.paymentAttemptId,
      journalEntryId: input.journalEntryId,
      reference: input.reference,
      reason,
      tradeStatus,
      currency: input.currency,
      amountMinor: input.amountMinor,
      expectedAmountMinor,
    },
    aggregateType: 'trade',
    aggregateId: input.tradeId,
  });
  if (tradeStatus === null) return;
  await recordActivity(tx, {
    tradeId: input.tradeId,
    type: 'ESCROW_ACTION_SETTLED',
    actorType: 'SYSTEM',
    summary: 'Money was escrowed for this trade but not applied to it; held for review, not refunded',
    metadata: {
      event: REVIEW_EVENT,
      reason,
      tradeStatus,
      paymentAttemptId: input.paymentAttemptId,
      journalEntryId: input.journalEntryId,
      reference: input.reference,
      amountMinor: input.amountMinor,
      expectedAmountMinor,
    },
  });
}
