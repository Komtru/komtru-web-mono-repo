// The ledger's read-only port onto the two modules funding depends on (design §6.4).
//
// The fee snapshot is on the trade, and the buyer's email is identity's; both are reached through
// their modules' barrels and read, never written. M8 D6 keeps the ledger out of M7's state: nothing
// here transitions a trade, and the only lock taken is FOR SHARE, so a concurrent cancellation waits
// for the funding posting to commit instead of interleaving with it.
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { userEmails, users } from '../../../identity/index.js';
import { trades } from '../../../trades/index.js';
import type { Tx } from '../../../../platform/events/publish.js';
import type { Db } from '../../../../db/index.js';
import type { TradeFundingSnapshot } from '../../domain/funding.js';

type Reader = Db | Tx;

export interface TradeForFunding extends TradeFundingSnapshot {
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
  buyerTotalMinor: trades.buyerTotalMinor,
};

export type TradeRef = { tradeId: string } | { tradeCode: string };

export async function findTradeForFunding(db: Reader, ref: TradeRef): Promise<TradeForFunding | undefined> {
  const where = 'tradeId' in ref ? eq(trades.id, ref.tradeId) : eq(trades.tradeCode, ref.tradeCode);
  const [row] = await db.select(columns).from(trades).where(where);
  return row;
}

/** The trade's status, held FOR SHARE until the caller's transaction ends. */
export async function shareLockTradeStatus(tx: Tx, tradeId: string): Promise<string | undefined> {
  const [row] = await tx
    .select({ status: trades.status })
    .from(trades)
    .where(eq(trades.id, tradeId))
    .for('share');
  return row?.status;
}

/**
 * Where Paystack sends the buyer's receipt: the primary email, else the newest verified one. An
 * account with neither cannot open a Paystack checkout at all (T-072 plan, owner decision 6).
 */
export async function buyerEmail(db: Reader, userId: string): Promise<string | undefined> {
  const [primary] = await db
    .select({ email: userEmails.email })
    .from(users)
    .innerJoin(userEmails, and(eq(userEmails.id, users.primaryEmailId), eq(userEmails.userId, users.id)))
    .where(eq(users.id, userId));
  if (primary) return primary.email;

  const [verified] = await db
    .select({ email: userEmails.email })
    .from(userEmails)
    .where(and(eq(userEmails.userId, userId), isNotNull(userEmails.verifiedAt)))
    .orderBy(desc(userEmails.verifiedAt))
    .limit(1);
  return verified?.email;
}
