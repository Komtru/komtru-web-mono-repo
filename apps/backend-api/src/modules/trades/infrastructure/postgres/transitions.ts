// The one way a trade's status moves. Every flow ticket goes through here.
//
// The guard is a single conditional UPDATE: `WHERE id = $1 AND status IN (<the states this action
// may leave>)`. Never a SELECT followed by an UPDATE — two transitions arriving together would both
// read the same status and both believe they were first. Here the second blocks on the row lock,
// re-evaluates against the committed status, matches nothing, and surfaces as 409. The database
// trigger (migration 0018) is the backstop for a caller that writes `status` another way.
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { EventActor } from '@komtru/shared-types';
import { ApiError } from '../../../../platform/errors.js';
import { publish, type Tx } from '../../../../platform/events/publish.js';
import { invalidTransitionError } from '../../domain/errors.js';
import { tradeStateChangedEvent, type TradeActorType } from '../../domain/events.js';
import { sourceStatuses, type TradeAction, type TradeStatus } from '../../domain/stateMachine.js';
import { trades } from './schema/trades.js';

export interface TradeActor {
  type: TradeActorType;
  /** Absent for SYSTEM and for the ledger answering a request. */
  id?: string;
}

export interface TransitionInput {
  tradeId: string;
  action: TradeAction;
  to: TradeStatus;
  actor: TradeActor;
  reason?: string;
  /** Recorded on the state change row: the dispute id, the signal source, the deadline that fired. */
  context?: Record<string, unknown>;
  /** Columns this transition also writes — a fee snapshot at ACCEPT, an inspection deadline at
   * DELIVERY_SIGNAL. They land in the same UPDATE, so either all of it happens or none of it. */
  set?: Partial<typeof trades.$inferInsert>;
  correlationId?: string;
  causationId?: string;
}

export interface TransitionResult {
  tradeId: string;
  tradeCode: string;
  from: TradeStatus;
  to: TradeStatus;
}

type TimestampColumn =
  | 'sentAt'
  | 'counterpartyBoundAt'
  | 'acceptedAt'
  | 'fundedAt'
  | 'shippedAt'
  | 'deliverySignalledAt'
  | 'deliveryConfirmedAt'
  | 'inspectionStartedAt'
  | 'completedAt'
  | 'settledAt'
  | 'cancelledAt'
  | 'expiredAt'
  | 'disputedAt';

/** The lifecycle timestamps a transition owns, so no caller has to remember them (M7 §4.2). */
const ACTION_TIMESTAMPS: Partial<Record<TradeAction, readonly TimestampColumn[]>> = {
  SEND: ['sentAt'],
  CLAIM_INVITATION: ['counterpartyBoundAt'],
  ACCEPT: ['acceptedAt'],
  FUND: ['fundedAt'],
  BEGIN_CUSTODY: ['shippedAt'],
  DELIVERY_SIGNAL: ['deliverySignalledAt'],
  CONFIRM_RECEIPT: ['deliveryConfirmedAt'],
  GRACE_ELAPSED: ['deliveryConfirmedAt'],
  COMPLETE: ['completedAt'],
  INSPECTION_ELAPSED: ['completedAt'],
  SETTLE: ['settledAt'],
  CANCEL: ['cancelledAt'],
  REFUND_CANCELLATION: ['cancelledAt'],
  EXPIRE: ['expiredAt'],
  DISPUTE: ['disputedAt'],
};

/** Reaching INSPECTION starts the clock, whichever action got the trade there (M7 D5). */
const STATUS_TIMESTAMPS: Partial<Record<TradeStatus, readonly TimestampColumn[]>> = {
  INSPECTION: ['inspectionStartedAt', 'deliveryConfirmedAt'],
};

const now = (): SQL => sql`now()`;

/** The envelope's actor is a session scope; the trade's own actor type is kept in the payload. */
const envelopeActor = (actor: TradeActor): EventActor => {
  const type =
    actor.type === 'STAFF'
      ? 'STAFF'
      : actor.type === 'LOGISTICS'
        ? 'LOGISTICS'
        : actor.type === 'BUYER' || actor.type === 'SELLER'
          ? 'CONSUMER'
          : 'SYSTEM';
  return actor.id ? { type, id: actor.id } : { type };
};

export async function applyTransition(tx: Tx, input: TransitionInput): Promise<TransitionResult> {
  const { tradeId, action, to, actor } = input;
  const from = sourceStatuses(action, to);

  const timestamps: Partial<Record<TimestampColumn, SQL>> = {};
  for (const column of [...(ACTION_TIMESTAMPS[action] ?? []), ...(STATUS_TIMESTAMPS[to] ?? [])]) {
    timestamps[column] = now();
  }

  const moved = from.length
    ? await tx
        .update(trades)
        .set({
          ...input.set,
          ...timestamps,
          status: to,
          statusAction: action,
          statusActorType: actor.type,
          statusActorId: actor.id ?? null,
          statusReason: input.reason ?? null,
          statusContext: input.context ?? null,
          updatedAt: now(),
        })
        .where(and(eq(trades.id, tradeId), inArray(trades.status, [...from])))
        .returning({ tradeCode: trades.tradeCode })
    : [];

  const row = moved[0];
  if (!row) {
    // Nothing moved: either the trade is gone, or it is no longer where this action starts. The
    // read is only for the error message — the decision was already made by the UPDATE.
    const [current] = await tx.select({ status: trades.status }).from(trades).where(eq(trades.id, tradeId));
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Trade not found');
    throw invalidTransitionError(action, current.status, to);
  }

  // Only the three actions with more than one source status need the extra read; everywhere else
  // the map already names the single status the trade must have been in.
  const fromStatus = from.length === 1 ? from[0]! : await recordedFrom(tx, tradeId);

  await publish(tx, tradeStateChangedEvent, {
    payload: {
      tradeId,
      tradeCode: row.tradeCode,
      action,
      from: fromStatus,
      to,
      actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    },
    aggregateType: 'trade',
    aggregateId: tradeId,
    actor: envelopeActor(actor),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.causationId ? { causationId: input.causationId } : {}),
  });

  return { tradeId, tradeCode: row.tradeCode, from: fromStatus, to };
}

/** The status the audit trigger recorded this trade leaving, for an action with several sources. */
async function recordedFrom(tx: Tx, tradeId: string): Promise<TradeStatus> {
  const result = await tx.execute<{ from_status: TradeStatus }>(
    sql`SELECT from_status FROM trade.trade_state_changes
         WHERE trade_id = ${tradeId} ORDER BY id DESC LIMIT 1`,
  );
  const row = result.rows[0];
  if (!row) throw new Error('applyTransition(): the state change trigger wrote no row');
  return row.from_status;
}
