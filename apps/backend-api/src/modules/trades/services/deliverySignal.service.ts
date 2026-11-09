// The single delivery-signal consumer (T-064, design §7.5). Courier packages (T-087), Park custody
// (T-093) and the two human entry points below all arrive here in the same payload, and only this
// function decides what a signal does to a trade (M7 §6). The publishers never touch trade state.
//
// SEAM(T-087, T-093): `logistics.package.delivered` and `park.parcel.released` are not published by
// anything yet. When those modules land, each subscribes to its own event in its module's `start()`
// and calls `applyDeliverySignal` with the payload; nothing in this file changes.
import { eq } from 'drizzle-orm';
import { ApiError } from '../../../platform/errors.js';
import type { Tx } from '../../../platform/events/publish.js';
import {
  decideDeliverySignal,
  deliverySignalPayloadSchema,
  isTrustedSignal,
  type DeliverySignalPayload,
  type DeliverySignalSource,
} from '../domain/deliverySignal.js';
import type { TradeStatus } from '../domain/stateMachine.js';
import { deliverySignals } from '../infrastructure/postgres/schema/fulfilment.js';
import { trades } from '../infrastructure/postgres/schema/trades.js';
import { applyTransition, type TradeActor } from '../infrastructure/postgres/transitions.js';
import { openDeadline, resolveDeadline } from './deadline.service.js';
import type { FulfilmentDeps } from './fulfilmentPorts.js';
import { loadTrade, recordActivity, requireParty, viewTrade } from './trade.service.js';

export type SignalOutcome =
  | { outcome: 'MOVED'; from: TradeStatus; to: TradeStatus }
  | { outcome: 'RECORDED'; why: 'NOT_AWAITING_DELIVERY' | 'AWAITING_BUYER_OR_GRACE' }
  | { outcome: 'DUPLICATE' }
  | { outcome: 'REJECTED'; why: 'WRONG_ACTOR' | 'TRADE_NOT_FOUND' };

const HUMAN_SOURCES: readonly DeliverySignalSource[] = ['BUYER_CONFIRMATION', 'SELLER_SELF_REPORT'];

/**
 * Records a signal and applies M7 §6's weighting to the trade, in one transaction under the trade's
 * row lock. Always safe to repeat: a courier or custody signal is deduplicated on its reference
 * (the `delivery_signals_shipment_event` index) and a human one on its source, so a redelivered
 * event is `DUPLICATE`, not a second transition. A signal the state machine has no arrow for is kept
 * as evidence and moves nothing. Never throws for a payload that cannot be acted on (an unknown
 * trade, the wrong person): an event handler that threw would be retried forever.
 */
export async function applyDeliverySignal(
  deps: Pick<FulfilmentDeps, 'db' | 'now'>,
  raw: DeliverySignalPayload,
): Promise<SignalOutcome> {
  const payload = deliverySignalPayloadSchema.parse(raw);
  return deps.db.transaction(async (tx) => {
    const [trade] = await tx.select().from(trades).where(eq(trades.id, payload.tradeId)).for('update');
    if (!trade) return { outcome: 'REJECTED', why: 'TRADE_NOT_FOUND' };

    const { source } = payload;
    if (
      (source === 'BUYER_CONFIRMATION' && payload.actorUserId !== trade.buyerUserId) ||
      (source === 'SELLER_SELF_REPORT' && payload.actorUserId !== trade.sellerUserId) ||
      (payload.actorUserId === null && HUMAN_SOURCES.includes(source))
    ) {
      return { outcome: 'REJECTED', why: 'WRONG_ACTOR' };
    }

    const priorSources = (
      await tx
        .select({ source: deliverySignals.source })
        .from(deliverySignals)
        .where(eq(deliverySignals.tradeId, trade.id))
    ).map((row) => row.source);

    if (!payload.reference && HUMAN_SOURCES.includes(source) && priorSources.includes(source)) {
      return { outcome: 'DUPLICATE' };
    }
    const [signal] = await tx
      .insert(deliverySignals)
      .values({
        tradeId: trade.id,
        source,
        reportedBy: HUMAN_SOURCES.includes(source) ? payload.actorUserId : null,
        shipmentEventId: payload.reference?.id ?? null,
        evidence: {
          occurredAt: payload.occurredAt,
          reference: payload.reference,
          hubId: payload.hubId ?? null,
        },
        reportedAt: new Date(payload.occurredAt),
      })
      .onConflictDoNothing()
      .returning({ id: deliverySignals.id });
    if (!signal) return { outcome: 'DUPLICATE' };

    const trusted = isTrustedSignal(source, priorSources);
    const decision = decideDeliverySignal({ status: trade.status, source, priorSources });
    const actorType =
      source === 'BUYER_CONFIRMATION' ? 'BUYER' : source === 'SELLER_SELF_REPORT' ? 'SELLER' : 'SYSTEM';

    if (decision.kind === 'RECORD_ONLY') {
      await logSignal(tx, trade.id, actorType, payload, { trusted, outcome: 'RECORDED', why: decision.why });
      return { outcome: 'RECORDED', why: decision.why };
    }

    const now = deps.now();
    const actor: TradeActor =
      actorType === 'BUYER' && payload.actorUserId
        ? { type: 'BUYER', id: payload.actorUserId }
        : actorType === 'SELLER' && payload.actorUserId
          ? { type: 'SELLER', id: payload.actorUserId }
          : payload.actorUserId
            ? { type: 'LOGISTICS', id: payload.actorUserId }
            : { type: 'SYSTEM' };
    const inspectionDeadline = new Date(now.getTime() + trade.inspectionWindowHours * 3_600_000);

    await applyTransition(tx, {
      tradeId: trade.id,
      action: decision.action,
      to: decision.to,
      actor,
      context: { signalId: signal.id, source, trusted },
      ...(decision.to === 'INSPECTION' ? { set: { inspectionDeadlineAt: inspectionDeadline } } : {}),
    });

    if (decision.to === 'INSPECTION') {
      // The inspection clock is started by whatever got the trade here (M7 D5). T-065 owns the job
      // that fires these two rows; it opens them with the same helper, which is idempotent.
      await openDeadline(tx, { tradeId: trade.id, kind: 'INSPECTION', dueAt: inspectionDeadline });
      await resolveDeadline(tx, {
        tradeId: trade.id,
        kind: 'UNCONFIRMED_DELIVERY_GRACE',
        status: 'MET',
        now,
      });
    } else {
      await openDeadline(tx, {
        tradeId: trade.id,
        kind: 'UNCONFIRMED_DELIVERY_GRACE',
        dueAt: new Date(now.getTime() + trade.deliveryGraceHours * 3_600_000),
      });
    }
    await resolveDeadline(tx, { tradeId: trade.id, kind: 'DELIVERY', status: 'MET', now });
    await logSignal(tx, trade.id, actorType, payload, {
      trusted,
      outcome: 'MOVED',
      from: trade.status,
      to: decision.to,
    });
    return { outcome: 'MOVED', from: trade.status, to: decision.to };
  });
}

const logSignal = (
  tx: Tx,
  tradeId: string,
  actorType: 'BUYER' | 'SELLER' | 'SYSTEM',
  payload: DeliverySignalPayload,
  metadata: Record<string, unknown>,
) =>
  recordActivity(tx, {
    tradeId,
    type: 'DELIVERY_SIGNAL_RECORDED',
    actorType,
    ...(payload.actorUserId ? { actorId: payload.actorUserId } : {}),
    summary: `Delivery signal from ${payload.source}`,
    metadata: { source: payload.source, reference: payload.reference, ...metadata },
  });

// ---------------------------------------------------------------------------
// The two human sources
// ---------------------------------------------------------------------------

const AT_OR_PAST_DELIVERY: readonly TradeStatus[] = ['INSPECTION', 'COMPLETED', 'SETTLED'];

const notShippedError = (status: TradeStatus): ApiError =>
  new ApiError(
    409,
    'INVALID_TRANSITION',
    'That step is not available on this trade',
    `Delivery can only be reported once a trade has shipped; this one is ${status}.`,
  );

async function humanSignal(
  deps: Pick<FulfilmentDeps, 'db' | 'now'>,
  input: { userId: string; tradeId: string },
  source: 'BUYER_CONFIRMATION' | 'SELLER_SELF_REPORT',
) {
  const role = source === 'BUYER_CONFIRMATION' ? 'BUYER' : 'SELLER';
  const status = await deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId);
    if (requireParty(trade, input.userId) !== role) {
      throw new ApiError(403, 'FORBIDDEN', `Only the ${role.toLowerCase()} can do this`);
    }
    return trade.status;
  });

  // The signal applies from SHIPPED, and from UNCONFIRMED_DELIVERY when the buyer is confirming. A
  // repeat by the same person (the trade is already there or past it) returns the trade as it
  // stands, like every other action here; anything else is not a step this trade can take.
  const applies =
    status === 'SHIPPED' || (source === 'BUYER_CONFIRMATION' && status === 'UNCONFIRMED_DELIVERY');
  if (!applies && status !== 'UNCONFIRMED_DELIVERY' && !AT_OR_PAST_DELIVERY.includes(status)) {
    throw notShippedError(status);
  }
  if (applies) {
    await applyDeliverySignal(deps, {
      tradeId: input.tradeId,
      source,
      occurredAt: deps.now().toISOString(),
      actorUserId: input.userId,
      reference: null,
    });
  }
  return deps.db.transaction(async (tx) => viewTrade(tx, await loadTrade(tx, input.tradeId), input.userId));
}

/** The buyer says they have it: INSPECTION from SHIPPED or UNCONFIRMED_DELIVERY (M7 D5). */
export const confirmDelivery = (
  deps: Pick<FulfilmentDeps, 'db' | 'now'>,
  input: { userId: string; tradeId: string },
) => humanSignal(deps, input, 'BUYER_CONFIRMATION');

/** The seller says it arrived: UNCONFIRMED_DELIVERY unless a courier or hub already vouched for it. */
export const reportDelivered = (
  deps: Pick<FulfilmentDeps, 'db' | 'now'>,
  input: { userId: string; tradeId: string },
) => humanSignal(deps, input, 'SELLER_SELF_REPORT');
