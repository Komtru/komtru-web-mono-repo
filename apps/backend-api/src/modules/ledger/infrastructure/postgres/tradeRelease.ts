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
import type { TradeReleaseSnapshot } from '../../domain/release.js';

type Reader = Db | Tx;

export interface TradeForRelease extends TradeReleaseSnapshot {
  tradeCode: string;
  status: string;
  sellerUserId: string | null;
}

const columns = {
  tradeId: trades.id,
  tradeCode: trades.tradeCode,
  status: trades.status,
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
 * The trade as a settlement reads it: the frozen fee columns, the seller, and the stored snapshot
 * verbatim. Held FOR SHARE until the caller's transaction ends.
 *
 * The snapshot is handed over UNPARSED on purpose. Parsing here would make a trade with an
 * unreadable `fee_snapshot` throw before the caller could even discover that its escrow was
 * settled correctly months ago — turning a harmless redelivery into a dead letter. The ledger
 * reads the JSONB in exactly two places, both of them past the replay check: Q4's flag when a
 * split returns the whole item, and `assertSnapshotMatchesColumns` before a first settlement.
 */
export async function lockTradeForRelease(tx: Tx, tradeId: string): Promise<TradeForRelease | undefined> {
  const [row] = await tx.select(columns).from(trades).where(eq(trades.id, tradeId)).for('share');
  return row;
}

/**
 * The sources of every hold still on the trade (design §6.2: a hold freezes auto-transitions and
 * release without hiding where the trade is). Empty is the normal case, and the only one that lets
 * money move.
 *
 * **CONTRACT FOR WHOEVER WRITES A HOLD (T-062, T-080, admin tooling): lock the trade row
 * `FOR UPDATE` in the same transaction as the INSERT.** The release path holds `trade.trades`
 * `FOR SHARE` and then reads this table, but a share lock on the trade does not block an INSERT
 * into `trade_holds` — and under READ COMMITTED an uncommitted hold is invisible here, so a
 * release placed at the same instant as a hold will post anyway. Taking `FOR UPDATE` on the trade
 * before inserting makes the hold writer wait for any in-flight release, and makes any later
 * release wait for the hold. Nothing writes this table yet, which is the only reason the gap is
 * theoretical today; it stops being theoretical the day it does.
 */
export async function activeTradeHolds(db: Reader, tradeId: string): Promise<string[]> {
  const rows = await db
    .select({ source: tradeHolds.source })
    .from(tradeHolds)
    .where(and(eq(tradeHolds.tradeId, tradeId), isNull(tradeHolds.releasedAt)));
  return rows.map((row) => row.source);
}
