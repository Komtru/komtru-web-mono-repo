// The clocks that act when nobody does (T-065): the inspection window elapsing (AR1), the
// unconfirmed-delivery grace period elapsing (M7 §6), and the ledger's answer that the escrow was
// released (`COMPLETED -> SETTLED`).
//
// The concurrency shape is T-064's `processDeliveryDeadline`, deliberately: the trade is locked
// `FOR UPDATE SKIP LOCKED` (another worker, or a buyer confirming right now, means "not me"), the
// deadline is locked after it, status, holds and disputes are re-read under those locks, and the row
// is claimed with a guarded `UPDATE ... WHERE status = 'PENDING' RETURNING` in the same transaction
// that moves the trade and publishes. A rerun, a second worker, a crash between steps or a buyer
// confirming at the same instant therefore produces the transition exactly once or not at all.
// Every judgement is in domain/inspection.ts.
//
// SEAM(T-080): `deps.disputes.hasOpenDispute` is the "a dispute exists" check; see inspectionPorts.ts.
import { and, eq, lte } from 'drizzle-orm';
import { type Tx } from '../../../platform/events/publish.js';
import {
  decideGraceElapsed,
  decideInspectionElapsed,
  type GraceDecision,
  type InspectionDecision,
} from '../domain/inspection.js';
import { tradeDeadlines } from '../infrastructure/postgres/schema/fulfilment.js';
import { trades } from '../infrastructure/postgres/schema/trades.js';
import { applyTransition } from '../infrastructure/postgres/transitions.js';
import { openDeadline } from './deadline.service.js';
import { closeInspectionDeadline, completeInspection, hasActiveHold } from './inspection.service.js';
import type { InspectionDeps } from './inspectionPorts.js';
import { recordActivity } from './trade.service.js';

export type InspectionOutcome = 'COMPLETED' | 'WAIT' | 'MET' | 'CANCELLED' | 'NOT_DUE' | 'LOCKED';
export type GraceOutcome = 'CONVERTED' | 'WAIT' | 'MET' | 'CANCELLED' | 'NOT_DUE' | 'LOCKED';

const INSPECTION_OUTCOME: Record<InspectionDecision, InspectionOutcome> = {
  COMPLETE: 'COMPLETED',
  WAIT: 'WAIT',
  CLOSE_MET: 'MET',
  CLOSE_CANCELLED: 'CANCELLED',
};

const GRACE_OUTCOME: Record<GraceDecision, GraceOutcome> = {
  CONVERT: 'CONVERTED',
  WAIT: 'WAIT',
  CLOSE_MET: 'MET',
  CLOSE_CANCELLED: 'CANCELLED',
};

/**
 * Locks, in the one order every writer uses (trade, then deadline), and re-reads what the decision
 * needs. `null` says why not: another transaction holds the trade, or the row is no longer due.
 */
type Locked =
  | { skip: 'NOT_DUE' | 'LOCKED' }
  | { skip?: undefined; trade: typeof trades.$inferSelect; deadline: typeof tradeDeadlines.$inferSelect };

async function lockDue(tx: Tx, deadlineId: string, now: Date): Promise<Locked> {
  const [pre] = await tx
    .select({ tradeId: tradeDeadlines.tradeId })
    .from(tradeDeadlines)
    .where(eq(tradeDeadlines.id, deadlineId));
  if (!pre) return { skip: 'NOT_DUE' };
  const [trade] = await tx
    .select()
    .from(trades)
    .where(eq(trades.id, pre.tradeId))
    .for('update', { skipLocked: true });
  if (!trade) return { skip: 'LOCKED' };
  const [deadline] = await tx
    .select()
    .from(tradeDeadlines)
    .where(eq(tradeDeadlines.id, deadlineId))
    .for('update');
  if (!deadline || deadline.status !== 'PENDING' || deadline.dueAt.getTime() > now.getTime()) {
    return { skip: 'NOT_DUE' };
  }
  return { trade, deadline };
}

// ---------------------------------------------------------------------------
// AR1: the inspection window elapsed
// ---------------------------------------------------------------------------

/** One due inspection deadline, inside the caller's transaction. Safe to call any number of times. */
export async function processInspectionDeadline(
  deps: Pick<InspectionDeps, 'disputes'>,
  tx: Tx,
  deadlineId: string,
  now: Date,
): Promise<InspectionOutcome> {
  const locked = await lockDue(tx, deadlineId, now);
  if (locked.skip) return locked.skip;
  const { trade, deadline } = locked;
  if (deadline.kind !== 'INSPECTION') return 'NOT_DUE';

  const decision = decideInspectionElapsed({
    status: trade.status,
    hasActiveHold: await hasActiveHold(tx, trade.id),
    hasOpenDispute: await deps.disputes.hasOpenDispute(tx, trade.id),
  });
  const outcome = INSPECTION_OUTCOME[decision];
  if (decision === 'WAIT') return outcome;

  const closed = await closeInspectionDeadline(tx, {
    deadlineId: deadline.id,
    tradeId: trade.id,
    status: decision === 'COMPLETE' ? 'ELAPSED' : decision === 'CLOSE_MET' ? 'MET' : 'CANCELLED',
    now,
    reason: decision === 'COMPLETE' ? 'Inspection window elapsed' : `Trade is ${trade.status}`,
  });
  if (!closed) return 'NOT_DUE';
  if (decision !== 'COMPLETE') return outcome;

  await recordActivity(tx, {
    tradeId: trade.id,
    type: 'DEADLINE_ELAPSED',
    actorType: 'SYSTEM',
    summary: 'Inspection window elapsed with no hold and no dispute; the trade completes',
    metadata: { kind: 'INSPECTION', deadlineId: deadline.id },
  });
  await completeInspection(tx, { trade, via: 'INSPECTION_ELAPSED', now, deadlineId: deadline.id });
  return outcome;
}

// ---------------------------------------------------------------------------
// M7 §6: the unconfirmed-delivery grace elapsed
// ---------------------------------------------------------------------------

/**
 * One due grace deadline. The seller said it arrived, the buyer did not confirm or dispute within the
 * snapshotted grace hours, so the delivery counts as confirmed (reason GRACE_PERIOD_ELAPSED) and the
 * inspection window starts from here, as it would on any other path.
 */
export async function processGraceDeadline(
  deps: Pick<InspectionDeps, 'disputes'>,
  tx: Tx,
  deadlineId: string,
  now: Date,
): Promise<GraceOutcome> {
  const locked = await lockDue(tx, deadlineId, now);
  if (locked.skip) return locked.skip;
  const { trade, deadline } = locked;
  if (deadline.kind !== 'UNCONFIRMED_DELIVERY_GRACE') return 'NOT_DUE';

  const decision = decideGraceElapsed({
    status: trade.status,
    hasActiveHold: await hasActiveHold(tx, trade.id),
    hasOpenDispute: await deps.disputes.hasOpenDispute(tx, trade.id),
  });
  const outcome = GRACE_OUTCOME[decision];
  if (decision === 'WAIT') return outcome;

  const claimed = await tx
    .update(tradeDeadlines)
    .set({
      status: decision === 'CONVERT' ? 'ELAPSED' : decision === 'CLOSE_MET' ? 'MET' : 'CANCELLED',
      resolvedAt: now,
      reason: decision === 'CONVERT' ? 'Grace period elapsed' : `Trade is ${trade.status}`,
    })
    .where(and(eq(tradeDeadlines.id, deadline.id), eq(tradeDeadlines.status, 'PENDING')))
    .returning({ id: tradeDeadlines.id });
  if (claimed.length === 0) return 'NOT_DUE';
  if (decision !== 'CONVERT') return outcome;

  const inspectionDeadline = new Date(now.getTime() + trade.inspectionWindowHours * 3_600_000);
  await applyTransition(tx, {
    tradeId: trade.id,
    action: 'GRACE_ELAPSED',
    to: 'INSPECTION',
    actor: { type: 'SYSTEM' },
    reason: 'GRACE_PERIOD_ELAPSED',
    context: { deadlineId: deadline.id },
    set: { inspectionDeadlineAt: inspectionDeadline },
  });
  await openDeadline(tx, { tradeId: trade.id, kind: 'INSPECTION', dueAt: inspectionDeadline });
  await recordActivity(tx, {
    tradeId: trade.id,
    type: 'DEADLINE_ELAPSED',
    actorType: 'SYSTEM',
    summary: 'The buyer did not confirm or dispute within the grace period; inspection starts',
    metadata: { kind: 'UNCONFIRMED_DELIVERY_GRACE', deadlineId: deadline.id },
  });
  return outcome;
}

// ---------------------------------------------------------------------------
// The sweeps (job bodies)
// ---------------------------------------------------------------------------

export type SweepSummary<O extends string> = { examined: number } & Partial<Record<O, number>>;

/**
 * Every pending deadline of `kind` whose time has come, each in its own transaction so one bad trade
 * cannot hold up or roll back another. A failure is rethrown after the rest were tried, so the
 * scheduler's log shows it and the next sweep retries it.
 */
async function sweep<O extends string>(
  deps: Pick<InspectionDeps, 'db' | 'now'>,
  kind: 'INSPECTION' | 'UNCONFIRMED_DELIVERY_GRACE',
  options: { limit?: number },
  process: (tx: Tx, id: string, now: Date) => Promise<O>,
): Promise<SweepSummary<O>> {
  const now = deps.now();
  const due = await deps.db
    .select({ id: tradeDeadlines.id })
    .from(tradeDeadlines)
    .where(
      and(
        eq(tradeDeadlines.kind, kind),
        eq(tradeDeadlines.status, 'PENDING'),
        lte(tradeDeadlines.dueAt, now),
      ),
    )
    .orderBy(tradeDeadlines.dueAt)
    .limit(options.limit ?? 200);

  const result = { examined: due.length } as SweepSummary<O>;
  let failure: Error | undefined;
  for (const { id } of due) {
    try {
      const outcome = await deps.db.transaction((tx) => process(tx, id, now));
      (result as Record<string, number>)[outcome] = ((result as Record<string, number>)[outcome] ?? 0) + 1;
    } catch (error) {
      failure ??= error instanceof Error ? error : new Error(String(error));
    }
  }
  if (failure) throw failure;
  return result;
}

export const sweepInspectionDeadlines = (
  deps: Pick<InspectionDeps, 'db' | 'now' | 'disputes'>,
  options: { limit?: number } = {},
) =>
  sweep<InspectionOutcome>(deps, 'INSPECTION', options, (tx, id, now) =>
    processInspectionDeadline(deps, tx, id, now),
  );

export const sweepGraceDeadlines = (
  deps: Pick<InspectionDeps, 'db' | 'now' | 'disputes'>,
  options: { limit?: number } = {},
) =>
  sweep<GraceOutcome>(deps, 'UNCONFIRMED_DELIVERY_GRACE', options, (tx, id, now) =>
    processGraceDeadline(deps, tx, id, now),
  );

// ---------------------------------------------------------------------------
// The ledger's answer
// ---------------------------------------------------------------------------

export type SettleOutcome = 'SETTLED' | 'ALREADY_SETTLED' | 'UNKNOWN_TRADE' | 'IGNORED';

/**
 * `ledger.payment.escrow_released`: the release journal has posted, so `COMPLETED -> SETTLED`. Runs in
 * the event's own transaction. Never throws for a trade it should not move, because a retried event
 * would fail the same way: already settled is a no-op, and any other state (a dispute-split release
 * belongs to T-080) is left alone and reported so the caller can log it. The settle is a fact about
 * money that already moved, so a hold does not stop it.
 */
export async function settleTrade(
  tx: Tx,
  input: { tradeId: string; journalEntryId: string },
): Promise<SettleOutcome> {
  const [trade] = await tx.select().from(trades).where(eq(trades.id, input.tradeId)).for('update');
  if (!trade) return 'UNKNOWN_TRADE';
  if (trade.status === 'SETTLED') return 'ALREADY_SETTLED';
  if (trade.status !== 'COMPLETED') return 'IGNORED';
  await applyTransition(tx, {
    tradeId: trade.id,
    action: 'SETTLE',
    to: 'SETTLED',
    actor: { type: 'LEDGER' },
    reason: 'ESCROW_RELEASED',
    context: { journalEntryId: input.journalEntryId },
  });
  await recordActivity(tx, {
    tradeId: trade.id,
    type: 'ESCROW_ACTION_SETTLED',
    actorType: 'SYSTEM',
    summary: 'The ledger released the escrow; the trade is settled',
    metadata: { event: 'ESCROW_RELEASED', journalEntryId: input.journalEntryId },
  });
  return 'SETTLED';
}
