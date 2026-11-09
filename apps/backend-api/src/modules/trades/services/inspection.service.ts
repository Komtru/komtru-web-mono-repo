// Inspection (T-065): the buyer compares the seller's proof with the delivery evidence (Z4), may ask
// once for more time (BEI1) which the seller answers (BEI2), and confirms and releases with an
// explicit acknowledgement (Z5). The clocks that act when nobody does are in
// inspectionDeadline.service.ts; the step that finishes an inspection, shared by both, is here.
//
// Every status change goes through `applyTransition`. This file never writes `status`.
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { ApiError } from '../../../platform/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { invalidTransitionError } from '../domain/errors.js';
import {
  extendedInspectionDeadline,
  RELEASE_ACKNOWLEDGEMENT,
  validateInspectionExtension,
} from '../domain/inspection.js';
import {
  tradeCompletedEvent,
  tradeInspectionExtensionRequestedEvent,
  tradeInspectionExtensionRespondedEvent,
} from '../domain/inspectionEvents.js';
import { tradeHolds } from '../infrastructure/postgres/schema/escrow.js';
import {
  deliverySignals,
  inspectionAcknowledgements,
  inspectionExtensionRequests,
  selfArrangedShipments,
  tradeDeadlines,
} from '../infrastructure/postgres/schema/fulfilment.js';
import { tradeProofMedia } from '../infrastructure/postgres/schema/proof.js';
import { trades } from '../infrastructure/postgres/schema/trades.js';
import { applyTransition, type TradeActor } from '../infrastructure/postgres/transitions.js';
import type { InspectionDeps } from './inspectionPorts.js';
import { loadTrade, recordActivity, requireParty, viewTrade, type TradeRow } from './trade.service.js';

type RequestRow = typeof inspectionExtensionRequests.$inferSelect;
type CompletionRoute = 'BUYER_CONFIRMED' | 'INSPECTION_ELAPSED';

const conflict = (reason: string, title: string, detail?: string): ApiError =>
  new ApiError(409, 'CONFLICT', title, detail, undefined, { reason });

export const inspectionExtensionView = (row: RequestRow) => ({
  id: row.id,
  deadlineId: row.deadlineId,
  status: row.status,
  extraHours: row.extraHours,
  note: row.note,
  currentDueAt: row.currentDueAt.toISOString(),
  requestedDueAt: row.requestedDueAt.toISOString(),
  respondedAt: row.respondedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

// ---------------------------------------------------------------------------
// Shared facts and steps
// ---------------------------------------------------------------------------

/** Holds freeze automatic transitions (design §6.2): any unreleased row, whatever its source. */
export async function hasActiveHold(tx: Tx, tradeId: string): Promise<boolean> {
  const [hold] = await tx
    .select({ id: tradeHolds.id })
    .from(tradeHolds)
    .where(and(eq(tradeHolds.tradeId, tradeId), isNull(tradeHolds.releasedAt)))
    .limit(1);
  return hold !== undefined;
}

/**
 * Closes the pending inspection deadline of a trade and settles any request on it: `LAPSED` when the
 * window elapsed with the seller silent, `CANCELLED` when the trade left the window another way.
 * Returns the row id when this call closed one.
 */
export async function closeInspectionDeadline(
  tx: Tx,
  input: {
    deadlineId?: string;
    tradeId: string;
    status: 'MET' | 'ELAPSED' | 'CANCELLED';
    now: Date;
    reason: string;
  },
): Promise<string | null> {
  const closed = await tx
    .update(tradeDeadlines)
    .set({ status: input.status, resolvedAt: input.now, reason: input.reason })
    .where(
      and(
        input.deadlineId
          ? eq(tradeDeadlines.id, input.deadlineId)
          : and(eq(tradeDeadlines.tradeId, input.tradeId), eq(tradeDeadlines.kind, 'INSPECTION')),
        eq(tradeDeadlines.status, 'PENDING'),
      ),
    )
    .returning({ id: tradeDeadlines.id });
  const id = closed[0]?.id ?? null;
  if (id) {
    const lapsed = input.status === 'ELAPSED';
    const settled = await tx
      .update(inspectionExtensionRequests)
      .set({ status: lapsed ? 'LAPSED' : 'CANCELLED' })
      .where(
        and(
          eq(inspectionExtensionRequests.deadlineId, id),
          eq(inspectionExtensionRequests.status, 'PENDING'),
        ),
      )
      .returning({ id: inspectionExtensionRequests.id });
    for (const request of settled) {
      await recordActivity(tx, {
        tradeId: input.tradeId,
        type: 'NOTE',
        actorType: 'SYSTEM',
        summary: lapsed
          ? 'The seller did not answer the request for more inspection time before the original deadline'
          : 'The request for more inspection time was withdrawn: the trade left inspection',
        metadata: {
          event: lapsed ? 'INSPECTION_EXTENSION_LAPSED' : 'INSPECTION_EXTENSION_CANCELLED',
          requestId: request.id,
        },
      });
    }
  }
  return id;
}

/**
 * INSPECTION -> COMPLETED, the one place it happens, for the buyer's confirmation and for the window
 * elapsing. The state change event is what the ledger releases escrow on (T-074); the completed event
 * says which route it was. Both are written in the caller's transaction.
 */
export async function completeInspection(
  tx: Tx,
  input: { trade: TradeRow; via: CompletionRoute; now: Date; deadlineId?: string },
): Promise<void> {
  const { trade, via } = input;
  const manual = via === 'BUYER_CONFIRMED';
  const buyerId = trade.buyerUserId;
  if (manual && !buyerId) throw new Error(`trades: trade ${trade.id} has no buyer to confirm it`);
  const actor: TradeActor = manual && buyerId ? { type: 'BUYER', id: buyerId } : { type: 'SYSTEM' };
  await applyTransition(tx, {
    tradeId: trade.id,
    action: manual ? 'COMPLETE' : 'INSPECTION_ELAPSED',
    to: 'COMPLETED',
    actor,
    reason: via,
    context: { via, ...(input.deadlineId ? { deadlineId: input.deadlineId } : {}) },
  });
  await recordActivity(tx, {
    tradeId: trade.id,
    type: 'NOTE',
    actorType: manual ? 'BUYER' : 'SYSTEM',
    ...(manual && buyerId ? { actorId: buyerId } : {}),
    summary: manual
      ? 'Buyer confirmed the item and released the payment'
      : 'The inspection window elapsed; the payment was released automatically',
    metadata: { event: 'TRADE_COMPLETED', via },
  });
  await publish(tx, tradeCompletedEvent, {
    payload: {
      tradeId: trade.id,
      tradeCode: trade.tradeCode,
      via,
      completedAt: input.now.toISOString(),
    },
    aggregateType: 'trade',
    aggregateId: trade.id,
    actor: manual && buyerId ? { type: 'CONSUMER', id: buyerId } : { type: 'SYSTEM' },
  });
}

// ---------------------------------------------------------------------------
// Z4: compare the seller's proof with the delivery evidence
// ---------------------------------------------------------------------------

/**
 * What Z4 renders for either party: the seller's pre-shipment proof beside the delivery evidence, the
 * window and any request for more time, and whether the automatic release is paused. A hold's source
 * and reason are not disclosed, only that the clock is stopped. The driver's phone is the seller's.
 */
export async function getInspection(
  deps: Pick<InspectionDeps, 'db' | 'now'>,
  input: { userId: string; tradeId: string },
) {
  return deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId);
    const role = requireParty(trade, input.userId);
    const [proof, signals, shipment, deadline, held, acknowledgement] = await Promise.all([
      tx
        .select({ fileId: tradeProofMedia.fileId, attachedAt: tradeProofMedia.createdAt })
        .from(tradeProofMedia)
        .where(eq(tradeProofMedia.tradeId, trade.id))
        .orderBy(asc(tradeProofMedia.createdAt), asc(tradeProofMedia.id)),
      tx
        .select()
        .from(deliverySignals)
        .where(eq(deliverySignals.tradeId, trade.id))
        .orderBy(asc(deliverySignals.reportedAt), asc(deliverySignals.id)),
      tx.select().from(selfArrangedShipments).where(eq(selfArrangedShipments.tradeId, trade.id)),
      tx
        .select()
        .from(tradeDeadlines)
        .where(and(eq(tradeDeadlines.tradeId, trade.id), eq(tradeDeadlines.kind, 'INSPECTION')))
        .orderBy(desc(tradeDeadlines.createdAt))
        .limit(1),
      hasActiveHold(tx, trade.id),
      tx.select().from(inspectionAcknowledgements).where(eq(inspectionAcknowledgements.tradeId, trade.id)),
    ]);
    const row = deadline[0];
    const [request] = row
      ? await tx
          .select()
          .from(inspectionExtensionRequests)
          .where(eq(inspectionExtensionRequests.deadlineId, row.id))
      : [];
    const inspecting = trade.status === 'INSPECTION';
    const open = row?.status === 'PENDING' && row.dueAt.getTime() > deps.now().getTime();
    const ship = shipment[0];
    return {
      tradeId: trade.id,
      tradeCode: trade.tradeCode,
      status: trade.status,
      yourRole: role,
      window: {
        hours: trade.inspectionWindowHours,
        startedAt: trade.inspectionStartedAt?.toISOString() ?? null,
        deadlineAt: (row?.dueAt ?? trade.inspectionDeadlineAt)?.toISOString() ?? null,
        extended: (row?.extensionCount ?? 0) > 0,
        autoReleasePaused: inspecting && held,
      },
      extensionRequest: request ? inspectionExtensionView(request) : null,
      canRequestMoreTime: role === 'BUYER' && inspecting && open && request === undefined,
      canRespondToRequest: role === 'SELLER' && inspecting && request?.status === 'PENDING',
      sellerProof: {
        media: proof.map((p) => ({ fileId: p.fileId, attachedAt: p.attachedAt.toISOString() })),
      },
      deliveryEvidence: {
        signals: signals.map((s) => ({
          source: s.source,
          reportedAt: s.reportedAt.toISOString(),
          reference: s.shipmentEventId,
        })),
        selfArranged: ship
          ? {
              waybillNumber: ship.waybillNumber,
              receiptFileId: ship.receiptFileId,
              vehiclePlate: ship.vehiclePlate,
              shippedAt: ship.createdAt.toISOString(),
              ...(role === 'SELLER' ? { driverPhone: ship.driverPhone } : {}),
            }
          : null,
      },
      release: {
        acknowledgement: RELEASE_ACKNOWLEDGEMENT,
        acknowledgedAt: acknowledgement[0]?.acknowledgedAt.toISOString() ?? null,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// BEI1 / BEI2
// ---------------------------------------------------------------------------

/** BEI1: the buyer asks, once, for more inspection time. */
export async function requestInspectionExtension(
  deps: Pick<InspectionDeps, 'db' | 'now'>,
  input: { userId: string; tradeId: string; extraHours: number; note?: string },
) {
  return deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId, true);
    if (requireParty(trade, input.userId) !== 'BUYER') {
      throw new ApiError(403, 'FORBIDDEN', 'Only the buyer can ask for more inspection time');
    }
    if (trade.status !== 'INSPECTION') {
      throw new ApiError(
        409,
        'INVALID_TRANSITION',
        'There is no inspection window to extend',
        `Inspection time can only be extended while a trade is in INSPECTION; this one is ${trade.status}.`,
      );
    }
    const [deadline] = await tx
      .select()
      .from(tradeDeadlines)
      .where(
        and(
          eq(tradeDeadlines.tradeId, trade.id),
          eq(tradeDeadlines.kind, 'INSPECTION'),
          eq(tradeDeadlines.status, 'PENDING'),
        ),
      )
      .for('update');
    if (!deadline) throw conflict('NO_OPEN_DEADLINE', 'This trade has no open inspection window');

    const [existing] = await tx
      .select()
      .from(inspectionExtensionRequests)
      .where(eq(inspectionExtensionRequests.deadlineId, deadline.id));
    if (existing) {
      if (
        existing.status === 'PENDING' &&
        existing.requestedByUserId === input.userId &&
        existing.extraHours === input.extraHours
      ) {
        return inspectionExtensionView(existing);
      }
      throw conflict('EXTENSION_ALREADY_REQUESTED', 'Inspection time can only be extended once');
    }

    const check = validateInspectionExtension({
      now: deps.now(),
      dueAt: deadline.dueAt,
      windowHours: trade.inspectionWindowHours,
      extraHours: input.extraHours,
    });
    if (!check.ok) {
      if (check.code === 'ALREADY_ELAPSED')
        throw conflict('ALREADY_ELAPSED', 'The inspection window has ended');
      throw new ApiError(422, 'VALIDATION_FAILED', 'Choose a different amount of time', undefined, [
        {
          path: 'extraHours',
          message:
            check.code === 'NOT_POSITIVE'
              ? 'Ask for a whole number of hours, at least 1'
              : `You can ask for at most ${trade.inspectionWindowHours} more hours`,
        },
      ]);
    }

    const requestedDueAt = extendedInspectionDeadline(deadline.dueAt, input.extraHours);
    const [request] = await tx
      .insert(inspectionExtensionRequests)
      .values({
        tradeId: trade.id,
        deadlineId: deadline.id,
        requestedByUserId: input.userId,
        extraHours: input.extraHours,
        note: input.note ?? null,
        currentDueAt: deadline.dueAt,
        requestedDueAt,
      })
      .returning();
    if (!request) throw new Error('trades: the inspection extension insert returned no row');
    await recordActivity(tx, {
      tradeId: trade.id,
      type: 'NOTE',
      actorType: 'BUYER',
      actorId: input.userId,
      summary: `Buyer asked for ${input.extraHours} more hours to inspect`,
      metadata: {
        event: 'INSPECTION_EXTENSION_REQUESTED',
        requestId: request.id,
        extraHours: input.extraHours,
      },
    });
    await publish(tx, tradeInspectionExtensionRequestedEvent, {
      payload: {
        tradeId: trade.id,
        tradeCode: trade.tradeCode,
        requestId: request.id,
        deadlineId: deadline.id,
        requestedByUserId: input.userId,
        extraHours: input.extraHours,
        currentDueAt: deadline.dueAt.toISOString(),
        requestedDueAt: requestedDueAt.toISOString(),
      },
      aggregateType: 'trade',
      aggregateId: trade.id,
      actor: { type: 'CONSUMER', id: input.userId },
    });
    return inspectionExtensionView(request);
  });
}

/** BEI2: the seller agrees (the deadline moves) or declines (the original date stands). */
export async function respondToInspectionExtension(
  deps: Pick<InspectionDeps, 'db' | 'now'>,
  input: { userId: string; tradeId: string; requestId: string; decision: 'ACCEPT' | 'DECLINE' },
) {
  return deps.db.transaction(async (tx) => {
    // Trade first, then request, then deadline: the order the sweep locks in.
    const trade = await loadTrade(tx, input.tradeId, true);
    if (requireParty(trade, input.userId) !== 'SELLER') {
      throw new ApiError(403, 'FORBIDDEN', 'Only the seller can answer a request for more inspection time');
    }
    const [request] = await tx
      .select()
      .from(inspectionExtensionRequests)
      .where(
        and(
          eq(inspectionExtensionRequests.id, input.requestId),
          eq(inspectionExtensionRequests.tradeId, trade.id),
        ),
      )
      .for('update');
    if (!request) throw new ApiError(404, 'NOT_FOUND', 'Request not found');

    const wanted = input.decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED';
    if (request.status === wanted) return inspectionExtensionView(request);
    if (request.status === 'LAPSED') {
      throw conflict('EXTENSION_LAPSED', 'The inspection window ended before this was answered');
    }
    if (request.status !== 'PENDING') {
      throw conflict('EXTENSION_ALREADY_ANSWERED', 'This request has already been dealt with');
    }

    const now = deps.now();
    const [deadline] = await tx
      .select()
      .from(tradeDeadlines)
      .where(eq(tradeDeadlines.id, request.deadlineId))
      .for('update');
    if (!deadline) throw new Error('trades: an inspection extension request lost its deadline');

    let newDueAt: Date | undefined;
    if (input.decision === 'ACCEPT') {
      // Accepting after the window has passed would reopen a deadline the sweep may be acting on.
      if (deadline.status !== 'PENDING' || deadline.dueAt.getTime() <= now.getTime()) {
        throw conflict('ALREADY_ELAPSED', 'The inspection window has already ended');
      }
      const moved = await tx
        .update(tradeDeadlines)
        .set({
          dueAt: request.requestedDueAt,
          extensionCount: deadline.extensionCount + 1,
          extendedByActorType: 'SELLER',
          extendedByActorId: input.userId,
        })
        .where(and(eq(tradeDeadlines.id, deadline.id), eq(tradeDeadlines.status, 'PENDING')))
        .returning({ id: tradeDeadlines.id });
      if (moved.length === 0) throw conflict('ALREADY_ELAPSED', 'The inspection window has already ended');
      await tx
        .update(trades)
        .set({ inspectionDeadlineAt: request.requestedDueAt })
        .where(eq(trades.id, trade.id));
      newDueAt = request.requestedDueAt;
    }

    const [answered] = await tx
      .update(inspectionExtensionRequests)
      .set({ status: wanted, respondedByUserId: input.userId, respondedAt: now })
      .where(eq(inspectionExtensionRequests.id, request.id))
      .returning();
    if (!answered) throw new Error('trades: the inspection extension answer returned no row');

    await recordActivity(tx, {
      tradeId: trade.id,
      type: newDueAt ? 'DEADLINE_EXTENDED' : 'NOTE',
      actorType: 'SELLER',
      actorId: input.userId,
      summary: newDueAt
        ? `Seller agreed to move the inspection deadline to ${newDueAt.toISOString()}`
        : 'Seller declined the request for more inspection time',
      metadata: {
        event: newDueAt ? 'INSPECTION_EXTENSION_ACCEPTED' : 'INSPECTION_EXTENSION_DECLINED',
        requestId: request.id,
      },
    });
    await publish(tx, tradeInspectionExtensionRespondedEvent, {
      payload: {
        tradeId: trade.id,
        tradeCode: trade.tradeCode,
        requestId: request.id,
        decision: wanted,
        respondedByUserId: input.userId,
        ...(newDueAt ? { newDueAt: newDueAt.toISOString() } : {}),
      },
      aggregateType: 'trade',
      aggregateId: trade.id,
      actor: { type: 'CONSUMER', id: input.userId },
    });
    return inspectionExtensionView(answered);
  });
}

// ---------------------------------------------------------------------------
// Z5: confirm and release
// ---------------------------------------------------------------------------

/**
 * The buyer confirms the item and releases the payment, having acknowledged that it is final. Only
 * the buyer, only from INSPECTION. A hold or an open dispute refuses it: the release would not run
 * under a hold, so the trade would reach COMPLETED with the money still in escrow (plan, question 1).
 * A repeat by the buyer who already confirmed returns the trade as it stands.
 */
export async function confirmAndRelease(
  deps: Pick<InspectionDeps, 'db' | 'now' | 'disputes'>,
  input: { userId: string; tradeId: string },
) {
  return deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId, true);
    if (requireParty(trade, input.userId) !== 'BUYER') {
      throw new ApiError(403, 'FORBIDDEN', 'Only the buyer can confirm and release');
    }
    if (trade.status === 'COMPLETED' || trade.status === 'SETTLED') {
      const [done] = await tx
        .select({ id: inspectionAcknowledgements.id })
        .from(inspectionAcknowledgements)
        .where(
          and(
            eq(inspectionAcknowledgements.tradeId, trade.id),
            eq(inspectionAcknowledgements.buyerUserId, input.userId),
          ),
        );
      if (done) return viewTrade(tx, trade, input.userId);
    }
    if (trade.status !== 'INSPECTION') throw invalidTransitionError('COMPLETE', trade.status, 'COMPLETED');
    if (await hasActiveHold(tx, trade.id)) {
      throw conflict(
        'HOLD_ACTIVE',
        'This trade is on hold',
        'The payment cannot be released while a hold is active.',
      );
    }
    if (await deps.disputes.hasOpenDispute(tx, trade.id)) {
      throw conflict('DISPUTE_OPEN', 'This trade has an open dispute');
    }

    const now = deps.now();
    await tx
      .insert(inspectionAcknowledgements)
      .values({ tradeId: trade.id, buyerUserId: input.userId, statementCode: RELEASE_ACKNOWLEDGEMENT })
      .onConflictDoNothing();
    const deadlineId = await closeInspectionDeadline(tx, {
      tradeId: trade.id,
      status: 'MET',
      now,
      reason: 'Buyer confirmed and released',
    });
    await completeInspection(tx, {
      trade,
      via: 'BUYER_CONFIRMED',
      now,
      ...(deadlineId ? { deadlineId } : {}),
    });
    return viewTrade(tx, await loadTrade(tx, trade.id), input.userId);
  });
}
