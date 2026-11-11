// What a person may read of a refund (T-075): CR3 and SC2's "refund issued", and the buyer's refund
// history (m8 plan §7, `GET /me/refunds`). Reads only. Every number is the ledger's own, from the
// refund row the decision wrote; a screen never computes one.
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { cursorPage, type CursorKey } from '../../../platform/http/paginate.js';
import type { Paginated } from '@komtru/shared-types';
import { listBuyerRefunds, listTradeRefunds } from '../infrastructure/postgres/refundsRepository.js';
import type { RefundRow } from '../infrastructure/postgres/schema/refunds.js';
import { tradeParties } from '../infrastructure/postgres/tradeRefund.js';

export interface RefundQueryDeps {
  db: Db;
}

export const refundView = (row: RefundRow) => ({
  id: row.id,
  tradeId: row.tradeId,
  /** OUR reference, `refund-<id>`: what support knows the refund by. */
  reference: row.reference,
  status: row.status,
  scope: row.scope,
  reason: row.reason,
  currency: row.currency,
  /** The item money returned. */
  itemAmountMinor: row.itemAmountMinor.toString(),
  /** The buyer protection fee returned with it; zero when it was kept. */
  feeAmountMinor: row.feeAmountMinor.toString(),
  /** What goes back to the buyer's payment method. */
  amountMinor: row.amountMinor.toString(),
  buyerProtectionFeeTreatment: row.feeTreatment as 'REFUND' | 'RECOGNISE' | 'RETAIN',
  /** FAILED or NEEDS_REVIEW: why, in words a buyer can read. */
  failureReason: row.failureReason,
  requestedAt: row.requestedAt.toISOString(),
  completedAt: row.completedAt?.toISOString() ?? null,
  failedAt: row.failedAt?.toISOString() ?? null,
});

export type RefundView = ReturnType<typeof refundView>;

const notFound = (): ApiError => new ApiError(404, 'NOT_FOUND', 'Trade not found');

/** A trade's refunds, newest first, for either party. A stranger is told the trade does not exist. */
export async function listRefundsForTrade(
  deps: RefundQueryDeps,
  input: { userId: string; tradeId: string },
): Promise<{ refunds: RefundView[] }> {
  const parties = await tradeParties(deps.db, input.tradeId);
  const userId = input.userId.toLowerCase();
  if (!parties || (parties.buyerUserId !== userId && parties.sellerUserId !== userId)) throw notFound();
  return { refunds: (await listTradeRefunds(deps.db, input.tradeId)).map(refundView) };
}

/** The caller's refunds as a buyer, newest first. */
export async function listMyRefunds(
  deps: RefundQueryDeps,
  input: { userId: string; limit: number; cursor?: CursorKey },
): Promise<Paginated<RefundView>> {
  const at = input.cursor?.requestedAt;
  const id = input.cursor?.id;
  const cursor =
    typeof at === 'string' && typeof id === 'string' && !Number.isNaN(Date.parse(at))
      ? { requestedAt: new Date(at), id }
      : undefined;
  if (input.cursor && !cursor) {
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'Invalid cursor',
      'Use the nextCursor from the previous page',
    );
  }
  const rows = await listBuyerRefunds(deps.db, input.userId.toLowerCase(), input.limit, cursor);
  return cursorPage(rows.map(refundView), input.limit, (view) => ({
    requestedAt: view.requestedAt,
    id: view.id,
  }));
}
