// Delivery-deadline rules, pure (T-064): when it falls, who may move it (DE1/DE2), and what the job
// does when it passes (DE3/DE4). The job in services/deadline.service.ts only gathers the facts and
// carries out the answer; every judgement is here, where it can be tested without a database.
import type { TradeStatus } from './stateMachine.js';

const DAY_MS = 24 * 3_600_000;

/** Funding starts the clock; the length is the category's `delivery_deadline_days` (Trade Standards). */
export const deliveryDeadlineFor = (fundedAt: Date, windowDays: number): Date =>
  new Date(fundedAt.getTime() + windowDays * DAY_MS);

export type ExtensionCheck =
  { ok: true } | { ok: false; code: 'ALREADY_OVERDUE' | 'ALREADY_EXTENDED' | 'NOT_LATER' | 'TOO_LONG' };

/**
 * DE1. One extension per deadline, asked for before it passes, to a strictly later date no more
 * than one original window beyond it. The "once" mirrors BEI1; the cap is an owner question
 * (plan, open question 3), chosen so a seller cannot buy open-ended time with a buyer's escrow.
 */
export function validateExtensionRequest(input: {
  now: Date;
  dueAt: Date;
  extensionCount: number;
  requestedDueAt: Date;
  windowDays: number;
}): ExtensionCheck {
  if (input.dueAt.getTime() <= input.now.getTime()) return { ok: false, code: 'ALREADY_OVERDUE' };
  if (input.extensionCount >= 1) return { ok: false, code: 'ALREADY_EXTENDED' };
  const extra = input.requestedDueAt.getTime() - input.dueAt.getTime();
  if (extra <= 0) return { ok: false, code: 'NOT_LATER' };
  if (extra > input.windowDays * DAY_MS) return { ok: false, code: 'TOO_LONG' };
  return { ok: true };
}

export type OverdueDecision =
  'REQUEST_REFUND' | 'ELAPSE_NO_REFUND' | 'WAIT' | 'CLOSE_MET' | 'CLOSE_CANCELLED';

/** The statuses that mean delivery happened (or went further); the deadline was met or moot. */
const DELIVERED_OR_BEYOND: readonly TradeStatus[] = [
  'UNCONFIRMED_DELIVERY',
  'INSPECTION',
  'COMPLETED',
  'SETTLED',
];

/**
 * DE3/DE4: what to do with a delivery deadline whose time has come.
 *
 * - Delivery already signalled: close it as met, whatever else is going on.
 * - Any state that is not a live fulfilment (disputed, refunded, cancelled, ...): close it as
 *   cancelled; someone else owns the trade now.
 * - Otherwise a hold or an open extension request means "not yet": the row stays pending and the
 *   next sweep looks again. Holds freeze automatic transitions (design §6.2).
 * - FUNDED, so nothing was shipped, and nobody asked for time: request the refund. DE4 says exactly
 *   this ("nothing shipped and no extension requested").
 * - SHIPPED: design §6.2 draws no refund edge after dispatch, so the deadline only elapses.
 */
export function decideOverdueDelivery(input: {
  status: TradeStatus;
  hasActiveHold: boolean;
  hasPendingExtension: boolean;
}): OverdueDecision {
  const { status } = input;
  if (DELIVERED_OR_BEYOND.includes(status)) return 'CLOSE_MET';
  if (status !== 'FUNDED' && status !== 'SHIPPED') return 'CLOSE_CANCELLED';
  if (input.hasActiveHold || input.hasPendingExtension) return 'WAIT';
  return status === 'FUNDED' ? 'REQUEST_REFUND' : 'ELAPSE_NO_REFUND';
}
