// The inspection reminder (T-068): one nudge per window, shortly before it closes, so a buyer who has
// not looked at the item is told the seller is about to be paid (AR1).
//
// The concurrency shape is `inspectionDeadline.service.ts`, deliberately: the trade is locked
// `FOR UPDATE SKIP LOCKED` (a buyer confirming right now, or another worker, means "not me"), the
// deadline is locked after it, status, holds and the dispute seam are re-read under those locks, and
// the reminder is claimed with one guarded `UPDATE ... WHERE reminder_sent_at IS NULL RETURNING` in the
// same transaction that publishes. A rerun, a second worker or a crash between steps therefore sends
// it exactly once or not at all. It never touches the trade's status: a reminder is information.
//
// SEAM(T-080): `deps.disputes.hasOpenDispute`, as for the sweeps beside it.
import { and, eq, gt, isNull, lte } from 'drizzle-orm';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { REMINDER_LEAD_CAP_HOURS, decideInspectionReminder } from '../domain/inspection.js';
import { tradeInspectionReminderDueEvent } from '../domain/inspectionEvents.js';
import { tradeDeadlines } from '../infrastructure/postgres/schema/fulfilment.js';
import { trades } from '../infrastructure/postgres/schema/trades.js';
import { hasActiveHold } from './inspection.service.js';
import type { InspectionDeps } from './inspectionPorts.js';

export type ReminderOutcome = 'REMINDED' | 'NOT_YET' | 'SKIPPED' | 'LOCKED';

export async function processInspectionReminder(
  deps: Pick<InspectionDeps, 'disputes'>,
  tx: Tx,
  deadlineId: string,
  now: Date,
): Promise<ReminderOutcome> {
  const [pre] = await tx
    .select({ tradeId: tradeDeadlines.tradeId })
    .from(tradeDeadlines)
    .where(eq(tradeDeadlines.id, deadlineId));
  if (!pre) return 'SKIPPED';
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
  if (!deadline || deadline.kind !== 'INSPECTION' || deadline.status !== 'PENDING') return 'SKIPPED';

  const decision = decideInspectionReminder({
    status: trade.status,
    hasActiveHold: await hasActiveHold(tx, trade.id),
    hasOpenDispute: await deps.disputes.hasOpenDispute(tx, trade.id),
    alreadyReminded: deadline.reminderSentAt !== null,
    dueAt: deadline.dueAt,
    now,
    windowHours: trade.inspectionWindowHours,
  });
  if (decision === 'NOT_YET') return 'NOT_YET';
  if (decision === 'SKIP') return 'SKIPPED';

  const claimed = await tx
    .update(tradeDeadlines)
    .set({ reminderSentAt: now })
    .where(
      and(
        eq(tradeDeadlines.id, deadline.id),
        eq(tradeDeadlines.status, 'PENDING'),
        isNull(tradeDeadlines.reminderSentAt),
      ),
    )
    .returning({ id: tradeDeadlines.id });
  if (!claimed.length) return 'SKIPPED';

  await publish(tx, tradeInspectionReminderDueEvent, {
    payload: {
      tradeId: trade.id,
      tradeCode: trade.tradeCode,
      deadlineId: deadline.id,
      dueAt: deadline.dueAt.toISOString(),
    },
    aggregateType: 'trade',
    aggregateId: trade.id,
    actor: { type: 'SYSTEM' },
  });
  return 'REMINDED';
}

export type ReminderSweepSummary = { examined: number } & Partial<Record<ReminderOutcome, number>>;

/**
 * Pending inspection deadlines due within the longest lead (a day) that have not been reminded; each
 * is judged precisely, with its own window, inside its own transaction. A failure is rethrown after
 * the rest were tried, so the scheduler's log shows it and the next sweep retries.
 */
export async function sweepInspectionReminders(
  deps: Pick<InspectionDeps, 'db' | 'now' | 'disputes'>,
  options: { limit?: number } = {},
): Promise<ReminderSweepSummary> {
  const now = deps.now();
  const horizon = new Date(now.getTime() + REMINDER_LEAD_CAP_HOURS * 3_600_000);
  const candidates = await deps.db
    .select({ id: tradeDeadlines.id })
    .from(tradeDeadlines)
    .innerJoin(trades, eq(trades.id, tradeDeadlines.tradeId))
    .where(
      and(
        eq(tradeDeadlines.kind, 'INSPECTION'),
        eq(tradeDeadlines.status, 'PENDING'),
        isNull(tradeDeadlines.reminderSentAt),
        gt(tradeDeadlines.dueAt, now),
        lte(tradeDeadlines.dueAt, horizon),
        eq(trades.status, 'INSPECTION'),
      ),
    )
    .orderBy(tradeDeadlines.dueAt)
    .limit(options.limit ?? 200);

  const result: ReminderSweepSummary = { examined: candidates.length };
  let failure: Error | undefined;
  for (const { id } of candidates) {
    try {
      const outcome = await deps.db.transaction((tx) => processInspectionReminder(deps, tx, id, now));
      result[outcome] = (result[outcome] ?? 0) + 1;
    } catch (error) {
      failure ??= error instanceof Error ? error : new Error(String(error));
    }
  }
  if (failure) throw failure;
  return result;
}
