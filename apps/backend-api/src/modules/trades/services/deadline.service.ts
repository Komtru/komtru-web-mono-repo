// Delivery deadlines (T-064): opening one when a trade is funded, the seller's request for more time
// and the buyer's answer (DE1, DE2), and the sweep that fires an overdue one (DE3, DE4).
//
// The deadline is a row, not a timestamp on the trade, so an extension leaves evidence and a job can
// be idempotent: the sweep claims a row with a guarded `UPDATE ... WHERE status = 'PENDING'` in the
// same transaction that publishes what the deadline means, so a rerun, a second worker or a crash
// between the two cannot publish twice or not at all. Every judgement is in domain/deadline.ts.
//
// SEAM(T-066, T-075): an overdue delivery on a FUNDED trade publishes `trades.refund.requested` and
// stops. It calls no refund service and writes no escrow request. T-075 consumes the event, writes
// the REFUND `escrow_action_requests` row from the fee snapshot, and on the ledger's answer moves the
// trade FUNDED -> CANCELLED_REFUNDED with REFUND_CANCELLATION and cancellation reason DELIVERY_OVERDUE.
import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { ApiError } from '../../../platform/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import {
  decideOverdueDelivery,
  deliveryDeadlineFor,
  validateExtensionRequest,
  type OverdueDecision,
} from '../domain/deadline.js';
import {
  tradeDeliveryExtensionRequestedEvent,
  tradeDeliveryExtensionRespondedEvent,
  tradeDeliveryOverdueEvent,
  tradeRefundRequestedEvent,
} from '../domain/fulfilmentEvents.js';
import { tradeHolds } from '../infrastructure/postgres/schema/escrow.js';
import { deliveryExtensionRequests, tradeDeadlines } from '../infrastructure/postgres/schema/fulfilment.js';
import { trades } from '../infrastructure/postgres/schema/trades.js';
import type { FulfilmentDeps } from './fulfilmentPorts.js';
import { requireSeller } from './fulfilment.service.js';
import { loadTrade, recordActivity, requireParty, type TradeRow } from './trade.service.js';

type DeadlineRow = typeof tradeDeadlines.$inferSelect;
type ExtensionRow = typeof deliveryExtensionRequests.$inferSelect;
type DeadlineKind = DeadlineRow['kind'];

const conflict = (reason: string, title: string, detail?: string): ApiError =>
  new ApiError(409, 'CONFLICT', title, detail, undefined, { reason });

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * Opens a pending deadline unless one of that kind is already pending (the partial unique index is
 * the arbiter, so two callers cannot both win). Exported for T-065, whose grace and inspection jobs
 * use the same rows. Returns the row, and whether this call created it.
 */
export async function openDeadline(
  tx: Tx,
  input: { tradeId: string; kind: DeadlineKind; dueAt: Date; reason?: string },
): Promise<{ row: DeadlineRow; created: boolean }> {
  const [row] = await tx
    .insert(tradeDeadlines)
    .values({
      tradeId: input.tradeId,
      kind: input.kind,
      dueAt: input.dueAt,
      originalDueAt: input.dueAt,
      reason: input.reason ?? null,
    })
    .onConflictDoNothing({
      target: [tradeDeadlines.tradeId, tradeDeadlines.kind],
      where: sql`${tradeDeadlines.status} = 'PENDING'`,
    })
    .returning();
  if (row) {
    await recordActivity(tx, {
      tradeId: input.tradeId,
      type: 'DEADLINE_SET',
      actorType: 'SYSTEM',
      summary: `${input.kind} deadline set for ${input.dueAt.toISOString()}`,
      metadata: { kind: input.kind, dueAt: input.dueAt.toISOString() },
    });
    return { row, created: true };
  }
  const [existing] = await tx
    .select()
    .from(tradeDeadlines)
    .where(
      and(
        eq(tradeDeadlines.tradeId, input.tradeId),
        eq(tradeDeadlines.kind, input.kind),
        eq(tradeDeadlines.status, 'PENDING'),
      ),
    );
  if (!existing) throw new Error('trades: a pending deadline conflicted and then vanished');
  return { row: existing, created: false };
}

/** Closes a pending deadline of `kind` for the trade, and withdraws any extension request on it. */
export async function resolveDeadline(
  tx: Tx,
  input: { tradeId: string; kind: DeadlineKind; status: 'MET' | 'CANCELLED'; now: Date; reason?: string },
): Promise<void> {
  const closed = await tx
    .update(tradeDeadlines)
    .set({ status: input.status, resolvedAt: input.now, reason: input.reason ?? null })
    .where(
      and(
        eq(tradeDeadlines.tradeId, input.tradeId),
        eq(tradeDeadlines.kind, input.kind),
        eq(tradeDeadlines.status, 'PENDING'),
      ),
    )
    .returning({ id: tradeDeadlines.id });
  for (const { id } of closed) await cancelPendingRequests(tx, id);
}

const cancelPendingRequests = (tx: Tx, deadlineId: string) =>
  tx
    .update(deliveryExtensionRequests)
    .set({ status: 'CANCELLED' })
    .where(
      and(
        eq(deliveryExtensionRequests.deadlineId, deadlineId),
        eq(deliveryExtensionRequests.status, 'PENDING'),
      ),
    );

/**
 * Funding starts the delivery clock: `funded_at` plus the `delivery_deadline_days` of the Trade
 * Standards version the trade pinned. Idempotent, and never reopens one that already elapsed.
 */
export async function openDeliveryDeadline(
  deps: Pick<FulfilmentDeps, 'standards'>,
  tx: Tx,
  tradeId: string,
): Promise<DeadlineRow | null> {
  const trade = await loadTrade(tx, tradeId, true);
  if ((trade.status !== 'FUNDED' && trade.status !== 'SHIPPED') || !trade.fundedAt) return null;
  const [any] = await tx
    .select()
    .from(tradeDeadlines)
    .where(and(eq(tradeDeadlines.tradeId, tradeId), eq(tradeDeadlines.kind, 'DELIVERY')))
    .orderBy(desc(tradeDeadlines.createdAt))
    .limit(1);
  if (any) return any.status === 'PENDING' ? any : null;
  const standard = await standardOf(deps, trade);
  const { row } = await openDeadline(tx, {
    tradeId,
    kind: 'DELIVERY',
    dueAt: deliveryDeadlineFor(trade.fundedAt, standard.deliveryDeadlineDays),
  });
  return row;
}

async function standardOf(deps: Pick<FulfilmentDeps, 'standards'>, trade: TradeRow) {
  if (!trade.categoryId || trade.tradeStandardVersion === null) {
    throw new Error(`trades: trade ${trade.id} has no pinned Trade Standards version`);
  }
  return deps.standards.pinned(trade.categoryId, trade.tradeStandardVersion);
}

// ---------------------------------------------------------------------------
// DE1 / DE2
// ---------------------------------------------------------------------------

export const extensionView = (row: ExtensionRow) => ({
  id: row.id,
  deadlineId: row.deadlineId,
  status: row.status,
  reason: row.reason,
  note: row.note,
  currentDueAt: row.currentDueAt.toISOString(),
  requestedDueAt: row.requestedDueAt.toISOString(),
  respondedAt: row.respondedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

const deadlineView = (row: DeadlineRow) => ({
  id: row.id,
  status: row.status,
  dueAt: row.dueAt.toISOString(),
  originalDueAt: row.originalDueAt.toISOString(),
  extensionCount: row.extensionCount,
});

/** What DE1, DE2 and DE3 render: the delivery deadline and the extension request on it, for either party. */
export async function getDeliveryDeadline(
  deps: Pick<FulfilmentDeps, 'db'>,
  input: { userId: string; tradeId: string },
) {
  return deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId);
    requireParty(trade, input.userId);
    const [deadline] = await tx
      .select()
      .from(tradeDeadlines)
      .where(and(eq(tradeDeadlines.tradeId, trade.id), eq(tradeDeadlines.kind, 'DELIVERY')))
      .orderBy(desc(tradeDeadlines.createdAt))
      .limit(1);
    const [request] = deadline
      ? await tx
          .select()
          .from(deliveryExtensionRequests)
          .where(eq(deliveryExtensionRequests.deadlineId, deadline.id))
          .orderBy(desc(deliveryExtensionRequests.createdAt))
          .limit(1)
      : [];
    return {
      deadline: deadline ? deadlineView(deadline) : null,
      extensionRequest: request ? extensionView(request) : null,
    };
  });
}

export async function requestExtension(
  deps: Pick<FulfilmentDeps, 'db' | 'standards' | 'now'>,
  input: {
    userId: string;
    tradeId: string;
    reason: ExtensionRow['reason'];
    requestedDueAt: Date;
    note?: string;
  },
) {
  return deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId, true);
    requireSeller(trade, input.userId);
    if (trade.status !== 'FUNDED' && trade.status !== 'SHIPPED') {
      throw new ApiError(
        409,
        'INVALID_TRANSITION',
        'There is no delivery deadline to extend',
        `A delivery deadline can only be extended while a trade is FUNDED or SHIPPED; this one is ${trade.status}.`,
      );
    }
    const [deadline] = await tx
      .select()
      .from(tradeDeadlines)
      .where(
        and(
          eq(tradeDeadlines.tradeId, trade.id),
          eq(tradeDeadlines.kind, 'DELIVERY'),
          eq(tradeDeadlines.status, 'PENDING'),
        ),
      )
      .for('update');
    if (!deadline) throw conflict('NO_OPEN_DEADLINE', 'This trade has no open delivery deadline');

    const [latest] = await tx
      .select()
      .from(deliveryExtensionRequests)
      .where(eq(deliveryExtensionRequests.deadlineId, deadline.id))
      .orderBy(desc(deliveryExtensionRequests.createdAt))
      .limit(1);
    if (latest?.status === 'PENDING') {
      if (
        latest.requestedByUserId === input.userId &&
        latest.requestedDueAt.getTime() === input.requestedDueAt.getTime()
      ) {
        return extensionView(latest);
      }
      throw conflict('EXTENSION_ALREADY_PENDING', 'You already have a request waiting for the buyer');
    }
    if (latest?.status === 'ACCEPTED' || latest?.status === 'DECLINED') {
      throw conflict(
        'EXTENSION_ALREADY_ANSWERED',
        'The buyer has already answered a request for this delivery',
      );
    }

    const standard = await standardOf(deps, trade);
    const check = validateExtensionRequest({
      now: deps.now(),
      dueAt: deadline.dueAt,
      extensionCount: deadline.extensionCount,
      requestedDueAt: input.requestedDueAt,
      windowDays: standard.deliveryDeadlineDays,
    });
    if (!check.ok) {
      if (check.code === 'ALREADY_OVERDUE' || check.code === 'ALREADY_EXTENDED') {
        throw conflict(check.code, 'More time cannot be requested now');
      }
      throw new ApiError(422, 'VALIDATION_FAILED', 'Choose a different delivery date', undefined, [
        {
          path: 'requestedDueAt',
          message:
            check.code === 'NOT_LATER'
              ? 'The new date must be after the current deadline'
              : `The new date can be at most ${standard.deliveryDeadlineDays} days after the current deadline`,
        },
      ]);
    }

    const [request] = await tx
      .insert(deliveryExtensionRequests)
      .values({
        tradeId: trade.id,
        deadlineId: deadline.id,
        requestedByUserId: input.userId,
        reason: input.reason,
        note: input.note ?? null,
        currentDueAt: deadline.dueAt,
        requestedDueAt: input.requestedDueAt,
      })
      .returning();
    if (!request) throw new Error('trades: the extension insert returned no row');
    await recordActivity(tx, {
      tradeId: trade.id,
      type: 'NOTE',
      actorType: 'SELLER',
      actorId: input.userId,
      summary: 'Seller asked for more time to deliver',
      metadata: { event: 'EXTENSION_REQUESTED', requestId: request.id, reason: input.reason },
    });
    await publish(tx, tradeDeliveryExtensionRequestedEvent, {
      payload: {
        tradeId: trade.id,
        tradeCode: trade.tradeCode,
        requestId: request.id,
        deadlineId: deadline.id,
        requestedByUserId: input.userId,
        reason: input.reason,
        currentDueAt: deadline.dueAt.toISOString(),
        requestedDueAt: request.requestedDueAt.toISOString(),
      },
      aggregateType: 'trade',
      aggregateId: trade.id,
      actor: { type: 'CONSUMER', id: input.userId },
    });
    return extensionView(request);
  });
}

export async function respondToExtension(
  deps: Pick<FulfilmentDeps, 'db' | 'now'>,
  input: { userId: string; tradeId: string; requestId: string; decision: 'ACCEPT' | 'DECLINE' },
) {
  return deps.db.transaction(async (tx) => {
    const trade = await loadTrade(tx, input.tradeId, true);
    if (requireParty(trade, input.userId) !== 'BUYER') {
      throw new ApiError(403, 'FORBIDDEN', 'Only the buyer can answer an extension request');
    }
    const [request] = await tx
      .select()
      .from(deliveryExtensionRequests)
      .where(
        and(
          eq(deliveryExtensionRequests.id, input.requestId),
          eq(deliveryExtensionRequests.tradeId, trade.id),
        ),
      )
      .for('update');
    if (!request) throw new ApiError(404, 'NOT_FOUND', 'Extension request not found');

    const wanted = input.decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED';
    if (request.status === wanted) return extensionView(request);
    if (request.status !== 'PENDING') {
      throw conflict('EXTENSION_ALREADY_ANSWERED', 'This request has already been dealt with');
    }

    const now = deps.now();
    const [deadline] = await tx
      .select()
      .from(tradeDeadlines)
      .where(eq(tradeDeadlines.id, request.deadlineId))
      .for('update');
    if (!deadline) throw new Error('trades: an extension request lost its deadline');

    let newDueAt: Date | undefined;
    if (input.decision === 'ACCEPT') {
      // Accepting a date after the old one has passed would reopen a deadline the job may already
      // be acting on; the buyer is told it is too late, and the original date stands.
      if (deadline.status !== 'PENDING' || deadline.dueAt.getTime() <= now.getTime()) {
        throw conflict('ALREADY_OVERDUE', 'The original delivery deadline has already passed');
      }
      const moved = await tx
        .update(tradeDeadlines)
        .set({
          dueAt: request.requestedDueAt,
          extensionCount: sql`${tradeDeadlines.extensionCount} + 1`,
          extendedByActorType: 'BUYER',
          extendedByActorId: input.userId,
        })
        .where(and(eq(tradeDeadlines.id, deadline.id), eq(tradeDeadlines.status, 'PENDING')))
        .returning({ dueAt: tradeDeadlines.dueAt });
      if (moved.length === 0)
        throw conflict('ALREADY_OVERDUE', 'The original delivery deadline has already passed');
      newDueAt = request.requestedDueAt;
    }

    const [answered] = await tx
      .update(deliveryExtensionRequests)
      .set({ status: wanted, respondedByUserId: input.userId, respondedAt: now })
      .where(eq(deliveryExtensionRequests.id, request.id))
      .returning();
    if (!answered) throw new Error('trades: the extension answer returned no row');

    await recordActivity(tx, {
      tradeId: trade.id,
      type: newDueAt ? 'DEADLINE_EXTENDED' : 'NOTE',
      actorType: 'BUYER',
      actorId: input.userId,
      summary: newDueAt
        ? `Buyer agreed to move delivery to ${newDueAt.toISOString()}`
        : 'Buyer declined the request for more time',
      metadata: { event: newDueAt ? 'EXTENSION_ACCEPTED' : 'EXTENSION_DECLINED', requestId: request.id },
    });
    await publish(tx, tradeDeliveryExtensionRespondedEvent, {
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

    // DE2: "declining makes this eligible for a refund once the original deadline passes". If it
    // already has, the sweep has been waiting only on this answer, so act now rather than in
    // up to five minutes.
    if (input.decision === 'DECLINE') await processDeliveryDeadline(tx, deadline.id, now);
    return extensionView(answered);
  });
}

// ---------------------------------------------------------------------------
// DE3 / DE4: the overdue sweep
// ---------------------------------------------------------------------------

export type DeadlineOutcome =
  'REFUND_REQUESTED' | 'ELAPSED_NO_REFUND' | 'WAIT' | 'MET' | 'CANCELLED' | 'NOT_DUE' | 'LOCKED';

const OUTCOME: Record<OverdueDecision, DeadlineOutcome> = {
  REQUEST_REFUND: 'REFUND_REQUESTED',
  ELAPSE_NO_REFUND: 'ELAPSED_NO_REFUND',
  WAIT: 'WAIT',
  CLOSE_MET: 'MET',
  CLOSE_CANCELLED: 'CANCELLED',
};

/**
 * One due delivery deadline, inside the caller's transaction. Reads everything fresh and decides
 * from that: the trade (locked, skipping one another worker holds), holds, an open extension
 * request. Safe to call any number of times for the same row.
 */
export async function processDeliveryDeadline(
  tx: Tx,
  deadlineId: string,
  now: Date,
): Promise<DeadlineOutcome> {
  const [pre] = await tx
    .select({ tradeId: tradeDeadlines.tradeId })
    .from(tradeDeadlines)
    .where(eq(tradeDeadlines.id, deadlineId));
  if (!pre) return 'NOT_DUE';

  // Trade first, then deadline: the same order requestExtension and respondToExtension lock in.
  const [trade] = await tx
    .select()
    .from(trades)
    .where(eq(trades.id, pre.tradeId))
    .for('update', { skipLocked: true });
  if (!trade) return 'LOCKED';
  const [deadline] = await tx
    .select()
    .from(tradeDeadlines)
    .where(eq(tradeDeadlines.id, deadlineId))
    .for('update');
  if (!deadline || deadline.status !== 'PENDING' || deadline.dueAt.getTime() > now.getTime())
    return 'NOT_DUE';

  const [hold] = await tx
    .select({ id: tradeHolds.id })
    .from(tradeHolds)
    .where(and(eq(tradeHolds.tradeId, trade.id), isNull(tradeHolds.releasedAt)))
    .limit(1);
  const [pending] = await tx
    .select({ id: deliveryExtensionRequests.id })
    .from(deliveryExtensionRequests)
    .where(
      and(
        eq(deliveryExtensionRequests.deadlineId, deadline.id),
        eq(deliveryExtensionRequests.status, 'PENDING'),
      ),
    )
    .limit(1);

  const decision = decideOverdueDelivery({
    status: trade.status,
    hasActiveHold: hold !== undefined,
    hasPendingExtension: pending !== undefined,
  });
  const outcome = OUTCOME[decision];
  if (decision === 'WAIT') return outcome;

  const closes = decision === 'CLOSE_MET' || decision === 'CLOSE_CANCELLED';
  const claimed = await tx
    .update(tradeDeadlines)
    .set({
      status: decision === 'CLOSE_MET' ? 'MET' : decision === 'CLOSE_CANCELLED' ? 'CANCELLED' : 'ELAPSED',
      resolvedAt: now,
      reason: closes ? `Trade is ${trade.status}` : 'Delivery deadline passed',
    })
    .where(and(eq(tradeDeadlines.id, deadline.id), eq(tradeDeadlines.status, 'PENDING')))
    .returning({ id: tradeDeadlines.id });
  if (claimed.length === 0) return 'NOT_DUE';
  if (closes) return outcome;

  const refund = decision === 'REQUEST_REFUND';
  await recordActivity(tx, {
    tradeId: trade.id,
    type: 'DEADLINE_ELAPSED',
    actorType: 'SYSTEM',
    summary: refund
      ? 'Delivery deadline passed with nothing shipped and no extension; a refund was requested'
      : 'Delivery deadline passed',
    metadata: { kind: 'DELIVERY', deadlineId: deadline.id, status: trade.status },
  });
  await publish(tx, tradeDeliveryOverdueEvent, {
    payload: {
      tradeId: trade.id,
      tradeCode: trade.tradeCode,
      deadlineId: deadline.id,
      status: trade.status as 'FUNDED' | 'SHIPPED',
      dueAt: deadline.dueAt.toISOString(),
      refundRequested: refund,
    },
    aggregateType: 'trade',
    aggregateId: trade.id,
  });
  if (refund) {
    await recordActivity(tx, {
      tradeId: trade.id,
      type: 'ESCROW_ACTION_REQUESTED',
      actorType: 'SYSTEM',
      summary: 'Full refund requested: delivery overdue',
      metadata: { event: 'REFUND_REQUESTED', reason: 'DELIVERY_OVERDUE', deadlineId: deadline.id },
    });
    await publish(tx, tradeRefundRequestedEvent, {
      payload: {
        tradeId: trade.id,
        tradeCode: trade.tradeCode,
        reason: 'DELIVERY_OVERDUE',
        scope: 'FULL',
        deadlineId: deadline.id,
      },
      aggregateType: 'trade',
      aggregateId: trade.id,
    });
  }
  return outcome;
}

export type SweepResult = { examined: number } & Partial<Record<DeadlineOutcome, number>>;

/**
 * The job body: every pending delivery deadline whose time has come, each in its own transaction
 * so one bad trade cannot hold up or roll back another. A failure is rethrown after the rest have
 * been tried, so the scheduler's log shows it and the next sweep retries it.
 */
export async function sweepDeliveryDeadlines(
  deps: Pick<FulfilmentDeps, 'db' | 'now'>,
  options: { limit?: number } = {},
): Promise<SweepResult> {
  const now = deps.now();
  const due = await deps.db
    .select({ id: tradeDeadlines.id })
    .from(tradeDeadlines)
    .where(
      and(
        eq(tradeDeadlines.kind, 'DELIVERY'),
        eq(tradeDeadlines.status, 'PENDING'),
        lte(tradeDeadlines.dueAt, now),
      ),
    )
    .orderBy(tradeDeadlines.dueAt)
    .limit(options.limit ?? 200);

  const result: SweepResult = { examined: due.length };
  let failure: Error | undefined;
  for (const { id } of due) {
    try {
      const outcome = await deps.db.transaction((tx) => processDeliveryDeadline(tx, id, now));
      result[outcome] = (result[outcome] ?? 0) + 1;
    } catch (error) {
      failure ??= error instanceof Error ? error : new Error(String(error));
    }
  }
  if (failure) throw failure;
  return result;
}
