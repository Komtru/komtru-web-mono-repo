// The ledger's read-only port onto the trade it is about to settle (T-074), beside funding's own
// (tradeFunding.ts).
//
// M8 D6 keeps the ledger out of M7's state: nothing here writes, nothing here transitions a trade,
// and the only lock taken is FOR SHARE — so a concurrent cancellation or dispute waits for the
// release posting to commit instead of interleaving with it. Holds are read through the trades
// barrel for the same reason: they are the trade's, and the ledger only obeys them.
import { and, eq, isNull } from 'drizzle-orm';
import { tradeHolds, trades } from '../../../trades/index.js';
import type { Tx } from '../../../../platform/events/publish.js';
import type { Db } from '../../../../db/index.js';
import { refundableOnFullRefundOf, type TradeReleaseSnapshot } from '../../domain/release.js';

type Reader = Db | Tx;

export interface TradeForRelease extends TradeReleaseSnapshot {
  tradeCode: string;
  status: string;
  buyerUserId: string | null;
  sellerUserId: string | null;
}

const columns = {
  tradeId: trades.id,
  tradeCode: trades.tradeCode,
  status: trades.status,
  buyerUserId: trades.buyerUserId,
  sellerUserId: trades.sellerUserId,
  currency: trades.currency,
  feeScheduleVersion: trades.feeScheduleVersion,
  itemAmountMinor: trades.itemAmountMinor,
  buyerProtectionFeeMinor: trades.buyerProtectionFeeMinor,
  commissionMinor: trades.commissionMinor,
  sellerProceedsMinor: trades.sellerProceedsMinor,
  feeSnapshot: trades.feeSnapshot,
};

/**
 * The trade as a settlement reads it: the frozen fee columns, the parties, and Q4's treatment out
 * of the stored snapshot. Held FOR SHARE until the caller's transaction ends.
 *
 * `refundableOnFullRefund` is null exactly when there is no snapshot at all — the nine columns are
 * written together or not at all (`trades_fee_snapshot_complete`) — so `releaseAmounts` reports
 * "no complete fee snapshot" rather than this port guessing a refund policy.
 */
export async function lockTradeForRelease(tx: Tx, tradeId: string): Promise<TradeForRelease | undefined> {
  const [row] = await tx.select(columns).from(trades).where(eq(trades.id, tradeId)).for('share');
  if (!row) return undefined;
  const { feeSnapshot, ...rest } = row;
  return {
    ...rest,
    refundableOnFullRefund: feeSnapshot === null ? null : refundableOnFullRefundOf(feeSnapshot),
  };
}

/**
 * The sources of every hold still on the trade (design §6.2: a hold freezes auto-transitions and
 * release without hiding where the trade is). Empty is the normal case, and the only one that lets
 * money move.
 */
export async function activeTradeHolds(db: Reader, tradeId: string): Promise<string[]> {
  const rows = await db
    .select({ source: tradeHolds.source })
    .from(tradeHolds)
    .where(and(eq(tradeHolds.tradeId, tradeId), isNull(tradeHolds.releasedAt)));
  return rows.map((row) => row.source);
}
