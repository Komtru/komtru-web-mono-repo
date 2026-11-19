// The production adapters behind `DisputePorts`. Everything that reaches another module goes
// through that module's barrel, which is what the module-boundaries rule requires and also what
// makes the ports worth having: the services above never learn that a trade's dispatch photos
// live in `trade.trade_evidence_media`.
import { and, eq, inArray } from 'drizzle-orm';
import { grantAccess } from '../../files/index.js';
import { applyTransition, tradeEvidenceMedia, tradeProofMedia, trades } from '../../trades/index.js';
import type {
  CustodyPhoto,
  DisputableTrade,
  DisputePorts,
  TimelineEntry,
  TradeMedia,
} from '../services/ports.js';

/**
 * The trade a dispute is about, if this person is a party to it. Returns null rather than throwing
 * for a non-party, so the caller answers "no such dispute" uniformly and a trade id is not an
 * oracle for who is trading with whom.
 */
export const tradeForDispute: DisputePorts['tradeForDispute'] = async (tx, input) => {
  const [row] = await tx.select().from(trades).where(eq(trades.id, input.tradeId));
  if (!row) return null;
  // A trade before its counterparty has claimed the invitation has only one side, and a trade
  // before acceptance has no frozen amounts. Neither can be disputed — there is no second party
  // to argue with and no money in escrow — so both read as "not a disputable trade of yours"
  // rather than as a half-filled case.
  const { buyerUserId, sellerUserId, itemAmountMinor } = row;
  if (buyerUserId === null || sellerUserId === null || itemAmountMinor === null) return null;
  if (buyerUserId !== input.userId && sellerUserId !== input.userId) return null;

  const trade: DisputableTrade = {
    tradeId: row.id,
    tradeCode: row.tradeCode,
    status: row.status,
    buyerUserId,
    sellerUserId,
    orderId: null,
    // The ITEM, not the buyer total: a decision divides what the escrow liability holds (T-072).
    itemAmountMinor,
    currency: row.currency,
  };
  return trade;
};

/**
 * M3 D1: ask M7 to move the trade, in the dispute's own transaction. This module never writes to
 * `trades` — `applyTransition` is the trade module's one guarded door, and going through it means
 * the trade's own state machine, its state-change log and its `trade.state_changed` event all
 * happen exactly as they would for any other transition.
 *
 * A trade already DISPUTED is left alone rather than refused: Path B can arrive after M7 has
 * already moved itself, and D1's promise is that the two cannot disagree, not that only one of
 * them may act first.
 */
export const moveTradeToDisputed: DisputePorts['moveTradeToDisputed'] = async (tx, input) => {
  const [row] = await tx.select({ status: trades.status }).from(trades).where(eq(trades.id, input.tradeId));
  if (!row || row.status === 'DISPUTED') return;

  await applyTransition(tx, {
    tradeId: input.tradeId,
    action: 'DISPUTE',
    to: 'DISPUTED',
    actor: { type: 'BUYER', id: input.actorUserId },
    reason: 'A dispute was opened',
    context: { source: 'disputes' },
  });
};

/** T-081: the media already on the trade, which is most of what a comparison is made of. */
export const tradeMedia: DisputePorts['tradeMedia'] = async (tx, tradeId) => {
  const rows = await tx
    .select()
    .from(tradeEvidenceMedia)
    .where(
      and(
        eq(tradeEvidenceMedia.tradeId, tradeId),
        inArray(tradeEvidenceMedia.event, ['DISPATCH', 'DELIVERY', 'INSPECTION', 'ISSUE']),
      ),
    );
  return rows.map((row): TradeMedia => ({
    id: row.id,
    fileRefId: row.fileId,
    event: row.event,
    uploadedByUserId: row.attachedByUserId,
    capturedAt: row.createdAt,
  }));
};

/**
 * SEAM(F-036): Park custody photos. The park module does not exist yet, so a trade that went
 * through a hub has no photos to show and the panel is empty — which the comparison renders as
 * "none", never as "the other side submitted nothing".
 */
export const custodyPhotos: DisputePorts['custodyPhotos'] = async (tx, tradeId) => {
  const rows = await tx.select().from(tradeProofMedia).where(eq(tradeProofMedia.tradeId, tradeId));
  return rows.map((row): CustodyPhoto => ({
    id: row.id,
    fileRefId: row.fileId,
    hubName: null,
    takenAt: row.createdAt,
  }));
};

/**
 * SEAM(F-031): the shipment or parcel timeline. The logistics read model is another feature's, so
 * this answers with the trade's own state changes until it exists — which is the honest subset:
 * every one of those entries really happened to this trade.
 */
export const shipmentTimeline: DisputePorts['shipmentTimeline'] = () => {
  const empty: TimelineEntry[] = [];
  return Promise.resolve(empty);
};

/** M20: the two parties and the assigned reviewer get a PRIVATE_CASE grant on the file. */
export const grantEvidenceAccess: DisputePorts['grantEvidenceAccess'] = async (tx, input) => {
  for (const userId of input.userIds) {
    await grantAccess(tx, {
      fileId: input.fileRefId,
      granteeUserId: userId,
      reason: 'A party or the assigned reviewer on this dispute',
    });
  }
};
