// Cancelling after funding (T-066, design §6.2, M7 D3): CR1 the buyer asks, CR2 the seller approves or
// declines, SC1 the seller cannot fulfil. Before funding a cancellation is a plain status change
// (`cancelTrade`, CT1) and stays that way.
//
// A trade never refunds anything (M7 §0 rule 2). Approving, or a seller's SC1, writes the APPROVED
// request and publishes `trades.refund.requested` in one transaction; the ledger decides the refund
// (T-075) and answers `ledger.payment.escrow_refunded`, and only then does `refundTrade` move the trade
// `FUNDED -> CANCELLED_REFUNDED`. Between the two, an approved request closes dispatch
// (`assertDispatchOpen`), so nothing ships against escrow that is being returned.
//
// Every write here locks the trade FOR UPDATE first: the same lock shipping, the delivery sweep and
// every transition take, so an approval and a shipment cannot both win.
import { and, desc, eq, isNull } from 'drizzle-orm';
import { ApiError } from '../../../platform/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import {
  tradeCancellationRequestedEvent,
  tradeCancellationRespondedEvent,
  type BUYER_CANCELLATION_REASONS,
  type SELLER_CANCELLATION_REASONS,
} from '../domain/cancellationEvents.js';
import { tradeRefundRequestedEvent } from '../domain/fulfilmentEvents.js';
import {
  cancellationRequests,
  type CancellationRequestRow,
} from '../infrastructure/postgres/schema/cancellation.js';
import { tradeHolds } from '../infrastructure/postgres/schema/escrow.js';
import { tradeDeadlines } from '../infrastructure/postgres/schema/fulfilment.js';
import { trades } from '../infrastructure/postgres/schema/trades.js';
import { applyTransition } from '../infrastructure/postgres/transitions.js';
import type { FulfilmentDeps } from './fulfilmentPorts.js';
import { loadTrade, recordActivity, requireParty, type TradeRow } from './trade.service.js';

type Deps = Pick<FulfilmentDeps, 'db' | 'now'>;
type BuyerReason = (typeof BUYER_CANCELLATION_REASONS)[number];
type SellerReason = (typeof SELLER_CANCELLATION_REASONS)[number];

const conflict = (reason: string, title: string, detail?: string): ApiError =>
  new ApiError(409, 'CONFLICT', title, detail, undefined, { reason });

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export const cancellationRequestView = (row: CancellationRequestRow) => ({
  id: row.id,
  requestedByRole: row.requestedByRole,
  reason: row.reason,
  note: row.note,
  status: row.status,
  responseNote: row.responseNote,
  respondedAt: row.respondedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

export type CancellationRequestView = ReturnType<typeof cancellationRequestView>;

const latestRequest = async (tx: Tx, tradeId: string): Promise<CancellationRequestRow | undefined> => {
  const [row] = await tx
    .select()
    .from(cancellationRequests)
    .where(eq(cancellationRequests.tradeId, tradeId))
    .orderBy(desc(cancellationRequests.createdAt))
    .limit(1);
  return row;
};

const hasActiveHold = async (tx: Tx, tradeId: string): Promise<boolean> => {
  const [hold] = await tx
    .select({ id: tradeHolds.id })
    .from(tradeHolds)
    .where(and(eq(tradeHolds.tradeId, tradeId), isNull(tradeHolds.releasedAt)))
    .limit(1);
  return hold !== undefined;
};

/**
 * Whether a refund for this trade has already been asked for: an approved cancellation, or DE3's
 * overdue delivery (its ELAPSED deadline is the record, as `assertDispatchOpen` reads it).
 */
async function refundAlreadyRequested(tx: Tx, tradeId: string): Promise<boolean> {
  const [approved] = await tx
    .select({ id: cancellationRequests.id })
    .from(cancellationRequests)
    .where(and(eq(cancellationRequests.tradeId, tradeId), eq(cancellationRequests.status, 'APPROVED')))
    .limit(1);
  if (approved) return true;
  const [elapsed] = await tx
    .select({ id: tradeDeadlines.id })
    .from(tradeDeadlines)
    .where(
      and(
        eq(tradeDeadlines.tradeId, tradeId),
        eq(tradeDeadlines.kind, 'DELIVERY'),
        eq(tradeDeadlines.status, 'ELAPSED'),
      ),
    )
    .limit(1);
  return elapsed !== undefined;
}

/**
 * What CR1, CR2, CR3, SC1 and SC2 render: the latest request on the trade and what the reader may do
 * now. The refund's own amount and progress are the ledger's (`GET /trades/:id/refunds`).
 */
export async function getCancellation(deps: Pick<Deps, 'db'>, input: { userId: string; tradeId: string }) {
  return deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId);
    const role = requireParty(trade, input.userId);
    const request = await latestRequest(tx, trade.id);
    const funded = trade.status === 'FUNDED';
    const open =
      funded && !(await hasActiveHold(tx, trade.id)) && !(await refundAlreadyRequested(tx, trade.id));
    return {
      tradeId: trade.id,
      tradeStatus: trade.status,
      yourRole: role,
      request: request ? cancellationRequestView(request) : null,
      refundRequested:
        trade.status === 'CANCELLED_REFUNDED' || (funded && (await refundAlreadyRequested(tx, trade.id))),
      actions: {
        // CR1: once per trade. A declined request is the seller's answer, not an invitation to ask again.
        canRequest: role === 'BUYER' && open && request === undefined,
        // CR2.
        canRespond: role === 'SELLER' && open && request?.status === 'PENDING',
        // SC1.
        canCancelAsSeller: role === 'SELLER' && open,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Guards shared by every write
// ---------------------------------------------------------------------------

/** FUNDED, not held, and no refund already on its way. Called with the trade locked FOR UPDATE. */
async function assertCancellable(tx: Tx, trade: TradeRow): Promise<void> {
  if (trade.status !== 'FUNDED') {
    throw new ApiError(
      409,
      'INVALID_TRANSITION',
      'This trade can no longer be cancelled here',
      trade.status === 'SHIPPED'
        ? 'The item has already shipped. If something is wrong once it arrives, raise a dispute.'
        : `A funded trade can be cancelled only before it ships; this one is ${trade.status}.`,
      undefined,
      { reason: 'NOT_FUNDED', status: trade.status },
    );
  }
  if (await hasActiveHold(tx, trade.id)) {
    throw conflict(
      'TRADE_HELD',
      'This trade is on hold',
      'Our team is reviewing this trade; contact support.',
    );
  }
  if (await refundAlreadyRequested(tx, trade.id)) {
    throw conflict('REFUND_ALREADY_REQUESTED', 'A refund for this trade is already on its way');
  }
}

/** Asks the ledger for the escrow back, in the caller's transaction (T-064's one intake). */
async function requestRefund(
  tx: Tx,
  trade: TradeRow,
  reason: 'SELLER_CANNOT_FULFIL' | 'MUTUAL_AGREEMENT',
  actor: { type: 'BUYER' | 'SELLER'; id: string },
  summary: string,
): Promise<void> {
  await recordActivity(tx, {
    tradeId: trade.id,
    type: 'ESCROW_ACTION_REQUESTED',
    actorType: actor.type,
    actorId: actor.id,
    summary,
    metadata: { event: 'REFUND_REQUESTED', reason },
  });
  await publish(tx, tradeRefundRequestedEvent, {
    payload: { tradeId: trade.id, tradeCode: trade.tradeCode, reason, scope: 'FULL' },
    aggregateType: 'trade',
    aggregateId: trade.id,
    actor: { type: 'CONSUMER', id: actor.id },
  });
}

// ---------------------------------------------------------------------------
// CR1: the buyer asks
// ---------------------------------------------------------------------------

export async function requestCancellation(
  deps: Pick<Deps, 'db'>,
  input: { userId: string; tradeId: string; reason: BuyerReason; note?: string },
): Promise<CancellationRequestView> {
  return deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId, true);
    if (requireParty(trade, input.userId) !== 'BUYER') {
      throw new ApiError(
        403,
        'FORBIDDEN',
        'Only the buyer can ask to cancel',
        'A seller who cannot fulfil uses cannot-fulfil.',
      );
    }
    const existing = await latestRequest(tx, trade.id);
    // A replay of the same request answers with it, whatever has happened since.
    if (
      existing?.requestedByRole === 'BUYER' &&
      existing.reason === input.reason &&
      existing.requestedByUserId === input.userId
    ) {
      return cancellationRequestView(existing);
    }
    await assertCancellable(tx, trade);
    if (existing) {
      throw conflict(
        existing.status === 'PENDING' ? 'CANCELLATION_ALREADY_PENDING' : 'CANCELLATION_ALREADY_ANSWERED',
        existing.status === 'PENDING'
          ? 'You have already asked the seller to cancel'
          : 'The seller has already answered a cancellation request on this trade',
      );
    }

    const [row] = await tx
      .insert(cancellationRequests)
      .values({
        tradeId: trade.id,
        requestedByRole: 'BUYER',
        requestedByUserId: input.userId,
        reason: input.reason,
        note: input.note ?? null,
      })
      .returning();
    if (!row) throw new Error('trades: the cancellation request insert returned no row');
    await recordActivity(tx, {
      tradeId: trade.id,
      type: 'NOTE',
      actorType: 'BUYER',
      actorId: input.userId,
      summary: 'Buyer asked to cancel before shipment',
      metadata: { event: 'CANCELLATION_REQUESTED', requestId: row.id, reason: input.reason },
    });
    await publish(tx, tradeCancellationRequestedEvent, {
      payload: {
        tradeId: trade.id,
        tradeCode: trade.tradeCode,
        requestId: row.id,
        requestedByUserId: input.userId,
        reason: input.reason,
      },
      aggregateType: 'trade',
      aggregateId: trade.id,
      actor: { type: 'CONSUMER', id: input.userId },
    });
    return cancellationRequestView(row);
  });
}

// ---------------------------------------------------------------------------
// CR2: the seller answers
// ---------------------------------------------------------------------------

export async function respondToCancellation(
  deps: Deps,
  input: {
    userId: string;
    tradeId: string;
    requestId: string;
    decision: 'APPROVE' | 'DECLINE';
    note?: string;
  },
): Promise<CancellationRequestView> {
  return deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId, true);
    if (requireParty(trade, input.userId) !== 'SELLER') {
      throw new ApiError(403, 'FORBIDDEN', 'Only the seller can answer a cancellation request');
    }
    const [request] = await tx
      .select()
      .from(cancellationRequests)
      .where(and(eq(cancellationRequests.id, input.requestId), eq(cancellationRequests.tradeId, trade.id)))
      .for('update');
    if (!request || request.requestedByRole !== 'BUYER') {
      throw new ApiError(404, 'NOT_FOUND', 'Cancellation request not found');
    }

    const wanted = input.decision === 'APPROVE' ? 'APPROVED' : 'DECLINED';
    if (request.status === wanted) return cancellationRequestView(request);
    if (request.status === 'LAPSED') {
      throw conflict(
        'CANCELLATION_LAPSED',
        'This request no longer applies',
        'The trade moved on before it was answered.',
      );
    }
    if (request.status !== 'PENDING') {
      throw conflict('CANCELLATION_ALREADY_ANSWERED', 'This request has already been answered');
    }
    // Declining needs no money check; approving asks for a refund and needs every one.
    if (input.decision === 'APPROVE') await assertCancellable(tx, trade);

    const [answered] = await tx
      .update(cancellationRequests)
      .set({
        status: wanted,
        respondedByUserId: input.userId,
        respondedAt: deps.now(),
        responseNote: input.note ?? null,
      })
      .where(eq(cancellationRequests.id, request.id))
      .returning();
    if (!answered) throw new Error('trades: the cancellation answer returned no row');

    await recordActivity(tx, {
      tradeId: trade.id,
      type: 'NOTE',
      actorType: 'SELLER',
      actorId: input.userId,
      summary:
        wanted === 'APPROVED'
          ? 'Seller agreed to cancel; a full refund was requested'
          : 'Seller declined to cancel',
      metadata: { event: `CANCELLATION_${wanted}`, requestId: request.id },
    });
    await publish(tx, tradeCancellationRespondedEvent, {
      payload: {
        tradeId: trade.id,
        tradeCode: trade.tradeCode,
        requestId: request.id,
        decision: wanted,
        respondedByUserId: input.userId,
      },
      aggregateType: 'trade',
      aggregateId: trade.id,
      actor: { type: 'CONSUMER', id: input.userId },
    });
    if (wanted === 'APPROVED') {
      await requestRefund(
        tx,
        trade,
        'MUTUAL_AGREEMENT',
        { type: 'SELLER', id: input.userId },
        'Full refund requested: cancellation agreed',
      );
    }
    return cancellationRequestView(answered);
  });
}

// ---------------------------------------------------------------------------
// SC1: the seller cannot fulfil
// ---------------------------------------------------------------------------

export async function cancelAsSeller(
  deps: Deps,
  input: { userId: string; tradeId: string; reason: SellerReason; note?: string },
): Promise<CancellationRequestView> {
  return deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId, true);
    if (requireParty(trade, input.userId) !== 'SELLER') {
      throw new ApiError(403, 'FORBIDDEN', 'Only the seller can cancel for being unable to fulfil');
    }
    const [own] = await tx
      .select()
      .from(cancellationRequests)
      .where(
        and(
          eq(cancellationRequests.tradeId, trade.id),
          eq(cancellationRequests.requestedByRole, 'SELLER'),
          eq(cancellationRequests.status, 'APPROVED'),
        ),
      );
    if (own && own.reason === input.reason) return cancellationRequestView(own);
    await assertCancellable(tx, trade);

    const now = deps.now();
    // A buyer's request still waiting is overtaken: the seller is cancelling anyway, so it can no
    // longer be answered, and the one-approved rule must see only the seller's row.
    const lapsed = await tx
      .update(cancellationRequests)
      .set({ status: 'LAPSED' })
      .where(and(eq(cancellationRequests.tradeId, trade.id), eq(cancellationRequests.status, 'PENDING')))
      .returning({ id: cancellationRequests.id });

    const [row] = await tx
      .insert(cancellationRequests)
      .values({
        tradeId: trade.id,
        requestedByRole: 'SELLER',
        requestedByUserId: input.userId,
        reason: input.reason,
        note: input.note ?? null,
        status: 'APPROVED',
        respondedByUserId: input.userId,
        respondedAt: now,
      })
      .returning();
    if (!row) throw new Error('trades: the seller cancellation insert returned no row');
    await recordActivity(tx, {
      tradeId: trade.id,
      type: 'NOTE',
      actorType: 'SELLER',
      actorId: input.userId,
      summary: 'Seller could not fulfil this trade',
      metadata: {
        event: 'SELLER_CANNOT_FULFIL',
        requestId: row.id,
        reason: input.reason,
        ...(lapsed.length ? { lapsedRequestIds: lapsed.map((r) => r.id) } : {}),
      },
    });
    await requestRefund(
      tx,
      trade,
      'SELLER_CANNOT_FULFIL',
      { type: 'SELLER', id: input.userId },
      'Full refund requested: seller cannot fulfil',
    );
    return cancellationRequestView(row);
  });
}

// ---------------------------------------------------------------------------
// The ledger's answer, and requests the trade moved past
// ---------------------------------------------------------------------------

const CANCELLATION_REASONS = ['MUTUAL_AGREEMENT', 'SELLER_CANNOT_FULFIL', 'DELIVERY_OVERDUE'] as const;
type PostFundingReason = (typeof CANCELLATION_REASONS)[number];
const isPostFundingReason = (value: string): value is PostFundingReason =>
  (CANCELLATION_REASONS as readonly string[]).includes(value);

export type RefundTradeOutcome = 'REFUNDED' | 'ALREADY_REFUNDED' | 'IGNORED' | 'UNKNOWN_TRADE';

/**
 * `ledger.payment.escrow_refunded`: `FUNDED -> CANCELLED_REFUNDED`, as the ledger, in the event's own
 * transaction. Never throws for a trade it should not move, because a retried event would fail the
 * same way: a trade already refunded is a no-op, and one that is no longer FUNDED is reported to the
 * caller, which logs it. A partial refund is a dispute outcome and is ignored here.
 */
export async function refundTrade(
  tx: Tx,
  input: {
    tradeId: string;
    refundId: string;
    journalEntryId: string;
    reason: string;
    scope: 'FULL' | 'PARTIAL';
  },
): Promise<RefundTradeOutcome> {
  if (input.scope !== 'FULL') return 'IGNORED';
  const [trade] = await tx.select().from(trades).where(eq(trades.id, input.tradeId)).for('update');
  if (!trade) return 'UNKNOWN_TRADE';
  if (trade.status === 'CANCELLED_REFUNDED') return 'ALREADY_REFUNDED';
  if (trade.status !== 'FUNDED') return 'IGNORED';

  const money = { refundId: input.refundId, journalEntryId: input.journalEntryId };
  await applyTransition(tx, {
    tradeId: trade.id,
    action: 'REFUND_CANCELLATION',
    to: 'CANCELLED_REFUNDED',
    actor: { type: 'LEDGER' },
    reason: input.reason,
    context: money,
    ...(isPostFundingReason(input.reason) ? { set: { cancellationReason: input.reason } } : {}),
  });
  await recordActivity(tx, {
    tradeId: trade.id,
    type: 'ESCROW_ACTION_SETTLED',
    actorType: 'SYSTEM',
    summary: "The ledger decided the buyer's refund; the trade is closed",
    metadata: { event: 'ESCROW_REFUNDED', reason: input.reason, ...money },
  });
  return 'REFUNDED';
}

/**
 * A buyer's request still waiting when the trade leaves FUNDED some other way — it shipped, or its
 * delivery deadline refunded the buyer anyway — can no longer be answered. Runs on the trade's state
 * change, in that event's transaction; idempotent.
 */
export async function lapsePendingCancellation(tx: Tx, tradeId: string): Promise<number> {
  const lapsed = await tx
    .update(cancellationRequests)
    .set({ status: 'LAPSED' })
    .where(and(eq(cancellationRequests.tradeId, tradeId), eq(cancellationRequests.status, 'PENDING')))
    .returning({ id: cancellationRequests.id });
  for (const { id } of lapsed) {
    await recordActivity(tx, {
      tradeId,
      type: 'NOTE',
      actorType: 'SYSTEM',
      summary: 'The cancellation request lapsed: the trade moved on before the seller answered',
      metadata: { event: 'CANCELLATION_LAPSED', requestId: id },
    });
  }
  return lapsed.length;
}

/** For `assertDispatchOpen`: an approved cancellation means a refund is on its way. */
export async function hasApprovedCancellation(tx: Tx, tradeId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: cancellationRequests.id })
    .from(cancellationRequests)
    .where(and(eq(cancellationRequests.tradeId, tradeId), eq(cancellationRequests.status, 'APPROVED')))
    .limit(1);
  return row !== undefined;
}
