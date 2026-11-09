// Sample trade events for the notification tests: one payload per plan that its own event schema
// accepts and its `applies` filter passes, so a test can run every plan without a hand-kept table.
import { randomUUID } from 'node:crypto';
import type { TradeNotificationPlan } from '../../../src/modules/trades/infrastructure/notifications.js';

export const buyer = randomUUID();
export const seller = randomUUID();
export const parties = { buyerUserId: buyer, sellerUserId: seller, initiatorUserId: seller };
export const code = 'KMT-7398512-NG';
export const tradeId = randomUUID();
export const now = '2026-11-09T10:00:00.000Z';

export const changed = (action: string, from: string, to: string, actorId?: string) => ({
  tradeId,
  tradeCode: code,
  action,
  from,
  to,
  actorType: 'SYSTEM',
  ...(actorId ? { actorId } : {}),
});

/** A payload the plan applies to, found by trying what the event can carry. */
export const samplePayload = (p: TradeNotificationPlan): unknown => {
  const base = { tradeId, tradeCode: code };
  const candidates: unknown[] = [
    ...(
      [
        ['SEND', 'AWAITING_ACCEPTANCE'],
        ['COUNTER_PROPOSE', 'AWAITING_ACCEPTANCE'],
        ['ACCEPT', 'PENDING_PAYMENT'],
        ['DECLINE', 'DECLINED'],
        ['REJECT_REVIEW', 'REJECTED'],
        ['FUND', 'FUNDED'],
        ['BEGIN_CUSTODY', 'SHIPPED'],
        ['DELIVERY_SIGNAL', 'INSPECTION'],
        ['DELIVERY_SIGNAL', 'UNCONFIRMED_DELIVERY'],
        ['SETTLE', 'SETTLED'],
        ['CANCEL', 'CANCELLED'],
        ['EXPIRE', 'EXPIRED'],
        ['REFUND_CANCELLATION', 'CANCELLED_REFUNDED'],
      ] as const
    ).map(([action, to]) => changed(action, action === 'CANCEL' ? 'PENDING_PAYMENT' : 'DRAFT', to, buyer)),
    { ...base, decision: 'ACCEPTED', requestId: tradeId, respondedByUserId: buyer },
    {
      ...base,
      requestId: tradeId,
      deadlineId: tradeId,
      requestedByUserId: buyer,
      reason: 'RESTOCKING_ITEM',
      currentDueAt: now,
      requestedDueAt: now,
    },
    {
      ...base,
      requestId: tradeId,
      deadlineId: tradeId,
      requestedByUserId: buyer,
      extraHours: 24,
      currentDueAt: now,
      requestedDueAt: now,
    },
    { ...base, deadlineId: tradeId, status: 'FUNDED', refundRequested: true, dueAt: now },
    { ...base, reason: 'DELIVERY_OVERDUE', scope: 'FULL' },
    { ...base, via: 'BUYER_CONFIRMED', completedAt: now },
    { ...base, via: 'INSPECTION_ELAPSED', completedAt: now },
    { ...base, dueAt: now, deadlineId: tradeId },
  ];
  const found = candidates.find((c) => p.event.payload.safeParse(c).success && p.applies(c));
  if (!found) throw new Error(`no sample payload applies to ${p.templateKey}`);
  return p.event.payload.parse(found);
};
