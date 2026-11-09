// One valid payload per pushed trade event, shared by the push and wire-contract tests.
import { randomUUID } from 'node:crypto';

export const tradeId = randomUUID();
export const tradeCode = 'KMT-7398512-NG';
export const user = randomUUID();
export const now = '2026-11-09T10:00:00.000Z';

export const envelope = (payload: unknown) =>
  ({ eventId: randomUUID(), eventType: 'x', occurredAt: now, payload }) as never;

export const SAMPLES: Record<string, unknown> = {
  'trades.trade.state_changed': {
    tradeId,
    tradeCode,
    action: 'ACCEPT',
    from: 'AWAITING_ACCEPTANCE',
    to: 'PENDING_PAYMENT',
    actorType: 'SELLER',
    actorId: user,
    reason: 'staff-only wording that must never reach a room',
  },
  'trades.delivery_extension.requested': {
    tradeId,
    tradeCode,
    requestId: randomUUID(),
    deadlineId: randomUUID(),
    requestedByUserId: user,
    reason: 'RESTOCKING_ITEM',
    currentDueAt: now,
    requestedDueAt: now,
  },
  'trades.delivery_extension.responded': {
    tradeId,
    tradeCode,
    requestId: randomUUID(),
    decision: 'ACCEPTED',
    respondedByUserId: user,
    newDueAt: now,
  },
  'trades.delivery.overdue': {
    tradeId,
    tradeCode,
    deadlineId: randomUUID(),
    status: 'FUNDED',
    dueAt: now,
    refundRequested: true,
  },
  'trades.refund.requested': {
    tradeId,
    tradeCode,
    reason: 'DELIVERY_OVERDUE',
    scope: 'FULL',
  },
  'trades.trade.completed': { tradeId, tradeCode, via: 'INSPECTION_ELAPSED', completedAt: now },
  'trades.inspection_extension.requested': {
    tradeId,
    tradeCode,
    requestId: randomUUID(),
    deadlineId: randomUUID(),
    requestedByUserId: user,
    extraHours: 24,
    currentDueAt: now,
    requestedDueAt: now,
  },
  'trades.inspection.reminder_due': {
    tradeId,
    tradeCode,
    deadlineId: randomUUID(),
    dueAt: now,
  },
  'trades.inspection_extension.responded': {
    tradeId,
    tradeCode,
    requestId: randomUUID(),
    decision: 'DECLINED',
    respondedByUserId: user,
  },
};
