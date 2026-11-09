// Releasing a trade's escrow (T-074). The trade completes, and the ledger discharges everything it
// holds for that trade in ONE journal: the item out of the escrow liability, the seller's share
// into their payable, the commission and the buyer protection fee into revenue.
//
// Three things make this safe to run twice, which it will be — the event bus delivers at least once
// and a dispute resolution can arrive on a trade a job is already settling:
//
//   * `trade:<id>:release` is the journal's idempotency key. A trade's escrow is settled once, by
//     one posting, whichever path settles it. `postJournal` returns the original on a replay and
//     refuses outright if the replay's lines differ, so a split arriving after a release is an
//     error rather than a second payment.
//   * the trade row is held FOR SHARE for the whole transaction, so a concurrent cancellation
//     cannot interleave with the posting.
//   * before posting anything, the escrow liability's balance must equal the snapshot's item
//     amount, and the fee liability's the snapshotted fee. This is the check that catches the one
//     mistake the balance invariant cannot: a posting that debits the buyer total instead of the
//     item still balances line for line, and would silently overdraw the escrow liability.
//
// Everything runs in the CALLER's transaction, including the event, so a crash between the journal
// and the announcement leaves neither.
import { koboToJson } from '@komtru/shared-types';
import { publish, type Tx } from '../../../platform/events/publish.js';
import type { Logger } from '../../../platform/logger.js';
import { paymentEscrowReleasedEvent } from '../domain/events.js';
import {
  planSettlement,
  releaseAmounts,
  releaseIdempotencyKey,
  type ReleaseAmounts,
  type Settlement,
  type SettlementShares,
} from '../domain/release.js';
import { accountBalance } from '../infrastructure/postgres/balancesRepository.js';
import { findJournalByKey } from '../infrastructure/postgres/journalRepository.js';
import {
  activeTradeHolds,
  lockTradeForRelease,
  type TradeForRelease,
} from '../infrastructure/postgres/tradeRelease.js';
import { postJournal } from './journal.service.js';

/**
 * Where a trade may be when its escrow is settled.
 *
 * A normal release answers `trade.completed`. A dispute split (T-080) is posted while the trade is
 * still `DISPUTED` — M7 moves it to `RESOLVED_*` on the strength of this event, the same way it
 * moves `COMPLETED → SETTLED` — so the two resolved states are allowed as well, for a resolution
 * whose posting is retried after the transition landed.
 */
export const RELEASABLE_STATUSES: Readonly<Record<Settlement['kind'], readonly string[]>> = {
  RELEASE: ['COMPLETED'],
  DISPUTE_SPLIT: ['DISPUTED', 'RESOLVED_RELEASED', 'RESOLVED_REFUNDED'],
};

export interface ReleaseDeps {
  logger: Logger;
}

export interface ReleaseInput {
  tradeId: string;
  /** Defaults to the whole-item release that `trade.completed` asks for. */
  settlement?: Settlement;
  correlationId?: string;
  causationId?: string;
  /** 'SYSTEM' unless a human decided it (T-080's resolver). */
  createdBy?: string;
}

export type ReleaseResult =
  /** Posted and announced, in the caller's transaction. */
  | { outcome: 'SETTLED'; journalEntryId: string; shares: SettlementShares; amounts: ReleaseAmounts }
  /** This exact settlement was already posted; nothing written, nothing published. */
  | { outcome: 'ALREADY_SETTLED'; journalEntryId: string }
  /** A hold on the trade blocks it. Nothing written; whoever lifts the hold asks again. */
  | { outcome: 'HELD'; holds: string[] }
  /** The trade is not in a state, or the ledger not in a shape, where this settlement is money. */
  | { outcome: 'NOT_RELEASABLE'; reason: string };

/**
 * Settles one trade's escrow. Returns rather than throws for every outcome a correctly working
 * system produces — a hold, a replay, a trade that moved on — because the caller is an event
 * subscriber whose only other move is to retry, and none of these are fixed by retrying. A
 * snapshot that does not add up, or a dispute split whose amounts do not sum to the escrowed item,
 * still throws: those are defects, and they throw before anything is written.
 */
export async function releaseEscrow(tx: Tx, deps: ReleaseDeps, input: ReleaseInput): Promise<ReleaseResult> {
  const settlement: Settlement = input.settlement ?? { kind: 'RELEASE' };
  const trade = await lockTradeForRelease(tx, input.tradeId);
  if (!trade) return { outcome: 'NOT_RELEASABLE', reason: 'the trade does not exist' };
  if (!trade.sellerUserId) {
    return { outcome: 'NOT_RELEASABLE', reason: 'the trade has no seller to credit' };
  }

  // Both throw on a defect, and both throw before the first write: a snapshot that does not add up,
  // or a split that does not sum to the escrowed item (the second check M3's trigger asks for).
  const amounts = releaseAmounts(trade);
  const parties = { tradeId: trade.tradeId, sellerUserId: trade.sellerUserId };
  const { lines, shares } = planSettlement(parties, amounts, settlement);

  const idempotencyKey = releaseIdempotencyKey(trade.tradeId);
  // The guards describe the state BEFORE a settlement. On a replay they would all fail — the escrow
  // liability is zero precisely because this posting already emptied it — so they are asked only
  // when nothing has been posted under this key yet. `postJournal` is the authority on whether the
  // replay really is one: it compares the lines and refuses if they differ.
  if ((await findJournalByKey(tx, idempotencyKey)) === null) {
    const refusal = await checkReleasable(tx, trade, amounts, settlement);
    if (refusal) {
      if (refusal.outcome === 'HELD') {
        deps.logger.warn(
          { tradeId: trade.tradeId, holds: refusal.holds },
          'ledger: release blocked by a hold on the trade',
        );
      } else {
        deps.logger.error(
          { tradeId: trade.tradeId, reason: refusal.reason },
          'ledger: a trade reached settlement with money the ledger does not recognise',
        );
      }
      return refusal;
    }
  }

  const posted = await postJournal(tx, {
    idempotencyKey,
    description: describe(settlement, trade, shares),
    currency: amounts.currency,
    tradeId: trade.tradeId,
    lines,
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.causationId ? { causationId: input.causationId } : {}),
  });

  // Only the transaction that wrote the journal announces it. A replay is silent because the first
  // posting already published, in the transaction that wrote it.
  if (!posted.posted) return { outcome: 'ALREADY_SETTLED', journalEntryId: posted.journalEntry.id };

  await publish(tx, paymentEscrowReleasedEvent, {
    aggregateType: 'ledger_journal_entry',
    aggregateId: posted.journalEntry.id,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.causationId ? { causationId: input.causationId } : {}),
    payload: {
      tradeId: trade.tradeId,
      journalEntryId: posted.journalEntry.id,
      sellerUserId: trade.sellerUserId,
      currency: amounts.currency,
      outcome: settlement.kind === 'RELEASE' ? 'RELEASED' : 'DISPUTE_SPLIT',
      itemAmountMinor: koboToJson(amounts.itemAmountMinor),
      sellerProceedsMinor: koboToJson(shares.sellerProceedsMinor),
      commissionMinor: koboToJson(shares.commissionMinor),
      refundToBuyerMinor: koboToJson(shares.refundToBuyerMinor),
      buyerProtectionFeeMinor: koboToJson(amounts.buyerProtectionFeeMinor),
      buyerProtectionFeeTreatment: shares.feeTreatment,
      releasedAt: posted.journalEntry.postedAt.toISOString(),
    },
  });

  return { outcome: 'SETTLED', journalEntryId: posted.journalEntry.id, shares, amounts };
}

/** Everything that must be true before money moves. Returns the refusal, or nothing. */
async function checkReleasable(
  tx: Tx,
  trade: TradeForRelease,
  amounts: ReleaseAmounts,
  settlement: Settlement,
): Promise<Extract<ReleaseResult, { outcome: 'HELD' | 'NOT_RELEASABLE' }> | undefined> {
  // Holds first: a held trade is not a broken one, and it should not be reported as one.
  const holds = await activeTradeHolds(tx, trade.tradeId);
  if (holds.length) return { outcome: 'HELD', holds };

  const allowed = RELEASABLE_STATUSES[settlement.kind];
  if (!allowed.includes(trade.status)) {
    return {
      outcome: 'NOT_RELEASABLE',
      reason: `the trade is ${trade.status}, not ${allowed.join(' or ')}`,
    };
  }

  // The ledger's own books, not the trade's columns. An escrow liability that does not hold exactly
  // the snapshotted item means the trade was never funded, was already refunded, or was funded
  // against a different snapshot — and in every one of those cases posting the snapshot's amounts
  // would move money that is not there.
  const escrow = await accountBalance(
    tx,
    { type: 'USER_ESCROW_LIABILITY', tradeId: trade.tradeId },
    amounts.currency,
  );
  if (escrow.balanceMinor !== amounts.itemAmountMinor) {
    return {
      outcome: 'NOT_RELEASABLE',
      reason: `escrow holds ${escrow.balanceMinor} for this trade, not the snapshotted item ${amounts.itemAmountMinor}`,
    };
  }

  const fee = await accountBalance(
    tx,
    { type: 'BUYER_PROTECTION_FEE_LIABILITY', tradeId: trade.tradeId },
    amounts.currency,
  );
  if (fee.balanceMinor !== amounts.buyerProtectionFeeMinor) {
    return {
      outcome: 'NOT_RELEASABLE',
      reason: `the protection fee liability holds ${fee.balanceMinor}, not the snapshotted fee ${amounts.buyerProtectionFeeMinor}`,
    };
  }
  return undefined;
}

/** What the journal says it is, in the ledger's own history. Bounded by `postJournalInputSchema`. */
const describe = (settlement: Settlement, trade: TradeForRelease, shares: SettlementShares): string =>
  settlement.kind === 'RELEASE'
    ? `escrow released for trade ${trade.tradeCode}`
    : `escrow split on dispute for trade ${trade.tradeCode}: seller ${shares.sellerProceedsMinor}, buyer ${shares.refundToBuyerMinor}, fee ${shares.feeTreatment.toLowerCase()}`;
