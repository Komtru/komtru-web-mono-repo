// Design §6.2, edge by edge. The machine is the product's safety rail: a jump it allows by accident
// is money moving at the wrong moment, so every edge is asserted individually rather than by
// rewriting the map in the test.
import { describe, expect, it } from 'vitest';
import {
  TRADE_ACTIONS,
  TRADE_STATUSES,
  TERMINAL_STATUSES,
  canTransition,
  isTerminal,
  isTransitionAllowed,
  sourceStatuses,
  type TradeAction,
  type TradeStatus,
} from '../../../../src/modules/trades/domain/stateMachine.js';

const EVERY_VALID_EDGE: [TradeAction, TradeStatus, TradeStatus][] = [
  ['SEND', 'DRAFT', 'PENDING_COUNTERPARTY'],
  ['SEND', 'DRAFT', 'UNDER_PROPOSAL_REVIEW'],
  ['SEND', 'DRAFT', 'AWAITING_ACCEPTANCE'],
  ['CLAIM_INVITATION', 'PENDING_COUNTERPARTY', 'UNDER_PROPOSAL_REVIEW'],
  ['CLAIM_INVITATION', 'PENDING_COUNTERPARTY', 'AWAITING_ACCEPTANCE'],
  ['EXPIRE', 'PENDING_COUNTERPARTY', 'EXPIRED'],
  ['EXPIRE', 'PENDING_PAYMENT', 'EXPIRED'],
  ['CLEAR_REVIEW', 'UNDER_PROPOSAL_REVIEW', 'AWAITING_ACCEPTANCE'],
  ['REJECT_REVIEW', 'UNDER_PROPOSAL_REVIEW', 'REJECTED'],
  ['COUNTER_PROPOSE', 'AWAITING_ACCEPTANCE', 'AWAITING_ACCEPTANCE'],
  ['ACCEPT', 'AWAITING_ACCEPTANCE', 'PENDING_PAYMENT'],
  ['DECLINE', 'AWAITING_ACCEPTANCE', 'DECLINED'],
  ['CANCEL', 'DRAFT', 'CANCELLED'],
  ['CANCEL', 'PENDING_COUNTERPARTY', 'CANCELLED'],
  ['CANCEL', 'UNDER_PROPOSAL_REVIEW', 'CANCELLED'],
  ['CANCEL', 'AWAITING_ACCEPTANCE', 'CANCELLED'],
  ['CANCEL', 'PENDING_PAYMENT', 'CANCELLED'],
  ['FUND', 'PENDING_PAYMENT', 'FUNDED'],
  ['BEGIN_CUSTODY', 'FUNDED', 'SHIPPED'],
  ['REFUND_CANCELLATION', 'FUNDED', 'CANCELLED_REFUNDED'],
  ['DELIVERY_SIGNAL', 'SHIPPED', 'INSPECTION'],
  ['DELIVERY_SIGNAL', 'SHIPPED', 'UNCONFIRMED_DELIVERY'],
  ['CONFIRM_RECEIPT', 'UNCONFIRMED_DELIVERY', 'INSPECTION'],
  ['GRACE_ELAPSED', 'UNCONFIRMED_DELIVERY', 'INSPECTION'],
  ['COMPLETE', 'INSPECTION', 'COMPLETED'],
  ['INSPECTION_ELAPSED', 'INSPECTION', 'COMPLETED'],
  ['SETTLE', 'COMPLETED', 'SETTLED'],
  ['DISPUTE', 'SHIPPED', 'DISPUTED'],
  ['DISPUTE', 'UNCONFIRMED_DELIVERY', 'DISPUTED'],
  ['DISPUTE', 'INSPECTION', 'DISPUTED'],
  ['RESOLVE_DISPUTE', 'DISPUTED', 'RESOLVED_REFUNDED'],
  ['RESOLVE_DISPUTE', 'DISPUTED', 'RESOLVED_RELEASED'],
];

/** One jump per state that design §6.2 does not draw, chosen to be the tempting one. */
const INVALID_JUMPS: [TradeAction, TradeStatus, TradeStatus][] = [
  ['FUND', 'DRAFT', 'FUNDED'],
  ['ACCEPT', 'PENDING_COUNTERPARTY', 'PENDING_PAYMENT'],
  ['ACCEPT', 'UNDER_PROPOSAL_REVIEW', 'PENDING_PAYMENT'],
  ['BEGIN_CUSTODY', 'AWAITING_ACCEPTANCE', 'SHIPPED'],
  ['BEGIN_CUSTODY', 'PENDING_PAYMENT', 'SHIPPED'],
  ['CANCEL', 'FUNDED', 'CANCELLED'],
  ['COMPLETE', 'SHIPPED', 'COMPLETED'],
  ['COMPLETE', 'UNCONFIRMED_DELIVERY', 'COMPLETED'],
  ['SETTLE', 'INSPECTION', 'SETTLED'],
  ['SETTLE', 'COMPLETED', 'COMPLETED'],
  ['DISPUTE', 'COMPLETED', 'DISPUTED'],
  ['DISPUTE', 'SETTLED', 'DISPUTED'],
  ['RESOLVE_DISPUTE', 'INSPECTION', 'RESOLVED_REFUNDED'],
  ['CLEAR_REVIEW', 'AWAITING_ACCEPTANCE', 'AWAITING_ACCEPTANCE'],
  ['CLAIM_INVITATION', 'DRAFT', 'AWAITING_ACCEPTANCE'],
  ['SEND', 'AWAITING_ACCEPTANCE', 'AWAITING_ACCEPTANCE'],
  ['EXPIRE', 'FUNDED', 'EXPIRED'],
  ['REFUND_CANCELLATION', 'SHIPPED', 'CANCELLED_REFUNDED'],
  ['DECLINE', 'PENDING_PAYMENT', 'DECLINED'],
];

const rank = (status: TradeStatus) => TRADE_STATUSES.indexOf(status);

describe('canTransition', () => {
  it.each(EVERY_VALID_EDGE)('allows %s from %s to %s', (action, from, to) => {
    expect(canTransition(action, from)).toContain(to);
    expect(isTransitionAllowed(action, from, to)).toBe(true);
  });

  it.each(INVALID_JUMPS)('refuses %s from %s to %s', (action, from, to) => {
    expect(isTransitionAllowed(action, from, to)).toBe(false);
  });

  it('draws exactly the edges design §6.2 draws, and no others', () => {
    const drawn = TRADE_ACTIONS.flatMap((action) =>
      TRADE_STATUSES.flatMap((from) => canTransition(action, from).map((to) => [action, from, to])),
    );
    expect(drawn).toHaveLength(EVERY_VALID_EDGE.length);
  });

  it('names the states an action may leave, for the conditional UPDATE', () => {
    expect([...sourceStatuses('DELIVERY_SIGNAL', 'INSPECTION')]).toEqual(['SHIPPED']);
    expect([...sourceStatuses('CANCEL', 'CANCELLED')]).toEqual([
      'DRAFT',
      'PENDING_COUNTERPARTY',
      'UNDER_PROPOSAL_REVIEW',
      'AWAITING_ACCEPTANCE',
      'PENDING_PAYMENT',
    ]);
    expect([...sourceStatuses('FUND', 'SETTLED')]).toEqual([]);
  });

  // M7 D3: from FUNDED onwards "cancelling" does not exist as a concept; there is only refunding.
  it('never cancels a funded trade', () => {
    const afterFunding = TRADE_STATUSES.filter((status) => rank(status) >= rank('FUNDED'));
    for (const status of afterFunding) expect(canTransition('CANCEL', status)).toEqual([]);
  });

  it('lets no transition leave a terminal state', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(isTerminal(status)).toBe(true);
      for (const action of TRADE_ACTIONS) expect(canTransition(action, status)).toEqual([]);
    }
  });

  // The one property that makes a status safe to reason about: it only ever moves on.
  it('only moves forwards, except the counter-proposal that keeps the turn', () => {
    for (const [action, from, to] of EVERY_VALID_EDGE) {
      if (action === 'COUNTER_PROPOSE') {
        expect(from).toBe(to);
        continue;
      }
      expect(rank(to)).toBeGreaterThan(rank(from));
    }
  });

  it('reaches every status from DRAFT', () => {
    const seen = new Set<TradeStatus>(['DRAFT']);
    for (let changed = true; changed;) {
      changed = false;
      for (const [, from, to] of EVERY_VALID_EDGE) {
        if (seen.has(from) && !seen.has(to)) {
          seen.add(to);
          changed = true;
        }
      }
    }
    expect([...seen].sort()).toEqual([...TRADE_STATUSES].sort());
  });
});
