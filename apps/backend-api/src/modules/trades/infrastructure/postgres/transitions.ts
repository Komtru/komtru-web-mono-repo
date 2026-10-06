// The one way a trade's status moves. Every flow ticket goes through here.
//
// The guard is a single conditional UPDATE: `WHERE id = $1 AND status IN (<the states this action
// may leave>)`. Never a SELECT followed by an UPDATE — two transitions arriving together would both
// read the same status and both believe they were first. Here the second blocks on the row lock,
// re-evaluates against the committed status, matches nothing, and surfaces as 409. The database
// trigger (migration 0018) is the backstop for a caller that writes `status` another way.
//
// A status condition cannot separate two transitions that leave the status where it is — two
// counter-proposals on the same trade would both match. Those actions carry `expectedRevision`
// instead, and the UPDATE adds `AND status_revision = $n`: the loser sees the revision has moved
// and gets the same 409 as any other stale attempt.
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { EventActor } from '@komtru/shared-types';
import { ApiError } from '../../../../platform/errors.js';
import { publish, type Tx } from '../../../../platform/events/publish.js';
import { invalidTransitionError } from '../../domain/errors.js';
import { tradeStateChangedEvent } from '../../domain/events.js';
import { sourceStatuses, type TradeAction, type TradeStatus } from '../../domain/stateMachine.js';
import { trades } from './schema/trades.js';

/**
 * A system or ledger transition has no person behind it; every other kind does, and the database
 * agrees (`trade_state_changes_actor_identified`). Typed as a union so "who did this" cannot be
 * left out by accident on the transitions where a person is accountable.
 */
export type TradeActor =
  | { type: 'SYSTEM' | 'LEDGER'; id?: string }
  | { type: 'BUYER' | 'SELLER' | 'STAFF' | 'LOGISTICS'; id: string };

export interface TransitionInput {
  tradeId: string;
  action: TradeAction;
  to: TradeStatus;
  actor: TradeActor;
  reason?: string;
  /** Recorded on the state change row: the dispute id, the signal source, the deadline that fired. */
  context?: Record<string, unknown>;
  /** Columns this transition also writes — a fee snapshot at ACCEPT, an inspection deadline at
   * DELIVERY_SIGNAL. They land in the same UPDATE, so either all of it happens or none of it.
   * Deliberately narrowed: the status, the revision and the audit columns are this function's to
   * write, and a caller that could pass `status` through here would be back to an unguarded
   * update with extra steps. */
  set?: Partial<Omit<typeof trades.$inferInsert, TransitionOwnedColumn>>;
  /** Required for an action that can leave the status unchanged; see the header. */
  expectedRevision?: number;
  correlationId?: string;
  causationId?: string;
}

export interface TransitionResult {
  tradeId: string;
  tradeCode: string;
  from: TradeStatus;
  to: TradeStatus;
  /** The trade's revision after this transition; pass it back for the next self-transition. */
  revision: number;
}

/** What only applyTransition may write: the state machine's own bookkeeping. */
type TransitionOwnedColumn =
  | 'id'
  | 'tradeCode'
  | 'status'
  | 'statusRevision'
  | 'previousStatus'
  | 'statusAction'
  | 'statusActorType'
  | 'statusActorId'
  | 'statusReason'
  | 'statusContext'
  | 'statusChangedAt'
  | 'createdAt'
  | 'updatedAt';

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
  CONFIRM_RECEIPT: [],
  GRACE_ELAPSED: [],
  COMPLETE: ['completedAt'],
  INSPECTION_ELAPSED: ['completedAt'],
  SETTLE: ['settledAt'],
  CANCEL: ['cancelledAt'],
  REFUND_CANCELLATION: ['cancelledAt'],
  EXPIRE: ['expiredAt'],
  DISPUTE: ['disputedAt'],
};

/**
 * Reaching INSPECTION starts the clock, whichever action got the trade there (M7 D5). Delivery is
 * *confirmed* only where something actually attested to it: the buyer saying so, a trusted signal,
 * or the grace period elapsing, which M7 §6 treats as confirmation on purpose. A self-report that
 * parks the trade in UNCONFIRMED_DELIVERY confirms nothing, and must not stamp that column.
 */
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

  // A self-transition cannot be told apart by status alone, so refusing it here is a bug report for
  // the caller, not a 409 for the user: there is no request that could have made it correct.
  if (from.includes(to) && input.expectedRevision === undefined) {
    throw new Error(`applyTransition(): ${action} can leave ${to} unchanged, so it needs expectedRevision`);
  }

  const timestamps: Partial<Record<TimestampColumn, SQL>> = {};
  for (const column of [...(ACTION_TIMESTAMPS[action] ?? []), ...(STATUS_TIMESTAMPS[to] ?? [])]) {
    timestamps[column] = now();
  }

  const conditions = [eq(trades.id, tradeId), inArray(trades.status, [...from])];
  if (input.expectedRevision !== undefined) {
    conditions.push(eq(trades.statusRevision, input.expectedRevision));
  }

  const moved = from.length
    ? await tx
        .update(trades)
        .set({
          ...input.set,
          ...timestamps,
          status: to,
          statusRevision: sql`${trades.statusRevision} + 1`,
          statusAction: action,
          statusActorType: actor.type,
          statusActorId: actor.id ?? null,
          statusReason: input.reason ?? null,
          statusContext: input.context ?? null,
          updatedAt: now(),
        })
        .where(and(...conditions))
        .returning({
          tradeCode: trades.tradeCode,
          // Stamped by the guard trigger in the same statement, so the event cannot report a
          // starting status the UPDATE did not actually leave.
          previousStatus: trades.previousStatus,
          revision: trades.statusRevision,
        })
    : [];

  const row = moved[0];
  if (!row) {
    // Nothing moved: either the trade is gone, or it is no longer where this action starts. The
    // read is only for the error message — the decision was already made by the UPDATE.
    const [current] = await tx.select({ status: trades.status }).from(trades).where(eq(trades.id, tradeId));
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Trade not found');
    throw invalidTransitionError(action, current.status, to);
  }

  const fromStatus = row.previousStatus ?? from[0]!;

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

  return { tradeId, tradeCode: row.tradeCode, from: fromStatus, to, revision: row.revision };
}
