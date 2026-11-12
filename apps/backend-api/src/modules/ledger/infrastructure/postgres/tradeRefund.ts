// The ledger's read-only port onto the trade it is about to refund (T-075), beside release's own
// (tradeRelease.ts). Nothing here writes or transitions a trade: the only lock is FOR SHARE, so a
// concurrent transition waits for the refund decision to commit instead of interleaving with it,
// exactly as it does for a release.
import { eq } from 'drizzle-orm';
import { trades } from '../../../trades/index.js';
import type { Tx } from '../../../../platform/events/publish.js';
import type { TradeForRelease } from './tradeRelease.js';

export interface TradeForRefund extends TradeForRelease {
  buyerUserId: string | null;
}

/** The trade as a refund reads it, held FOR SHARE. The stored snapshot is handed over unparsed. */
export async function lockTradeForRefund(tx: Tx, tradeId: string): Promise<TradeForRefund | undefined> {
  const [row] = await tx
    .select({
      tradeId: trades.id,
      tradeCode: trades.tradeCode,
      status: trades.status,
      sellerUserId: trades.sellerUserId,
      buyerUserId: trades.buyerUserId,
      currency: trades.currency,
      feeScheduleVersion: trades.feeScheduleVersion,
      itemAmountMinor: trades.itemAmountMinor,
      buyerProtectionFeeMinor: trades.buyerProtectionFeeMinor,
      commissionMinor: trades.commissionMinor,
      sellerProceedsMinor: trades.sellerProceedsMinor,
      feeSnapshot: trades.feeSnapshot,
    })
    .from(trades)
    .where(eq(trades.id, tradeId))
    .for('share');
  return row;
}

/**
 * The trade row alone, FOR SHARE: what a refund dispatch takes before it reads the trade's holds, so a
 * hold writer (which must lock the trade FOR UPDATE) cannot slip in between the check and the claim.
 */
export async function lockTradeShare(tx: Tx, tradeId: string): Promise<boolean> {
  const [row] = await tx.select({ id: trades.id }).from(trades).where(eq(trades.id, tradeId)).for('share');
  return row !== undefined;
}

/** Who may see a trade's refunds: its two parties. Undefined for a trade that does not exist. */
export async function tradeParties(
  db: Pick<Tx, 'select'>,
  tradeId: string,
): Promise<{ buyerUserId: string | null; sellerUserId: string | null } | undefined> {
  const [row] = await db
    .select({ buyerUserId: trades.buyerUserId, sellerUserId: trades.sellerUserId })
    .from(trades)
    .where(eq(trades.id, tradeId));
  return row;
}
