// Which trade event tells whom what (T-068). Pure: the audience is resolved through a stub of the
// party lookup, so the table of who-hears-what is checked without a database.
import { describe, expect, it } from 'vitest';
import {
  buyer,
  changed,
  code,
  now,
  parties,
  samplePayload,
  seller,
  tradeId,
} from '../notification-samples.js';
import {
  T093_SEAMS,
  TRADE_NOTIFICATION_PLANS,
  audienceFor,
  tradeDeepLink,
  type TradeNotificationPlan,
} from '../../../../src/modules/trades/infrastructure/notifications.js';

const plan = (key: string, eventType?: string): TradeNotificationPlan => {
  const found = TRADE_NOTIFICATION_PLANS.find(
    (p) => p.templateKey === key && (!eventType || p.event.eventType === eventType),
  );
  if (!found) throw new Error(`no plan for ${key}`);
  return found;
};

const who = (key: string, payload: unknown, p = parties) => {
  const found = plan(key);
  if (!found.applies(payload)) return null;
  return audienceFor(found, payload, p).map((r) => r.userId);
};

describe('the deep link', () => {
  it('is app.komtru.com/trades/<code>', () => {
    expect(tradeDeepLink(code)).toBe('https://app.komtru.com/trades/KMT-7398512-NG');
  });
});

describe('who hears what', () => {
  it('tells the party who did not initiate about a proposal that reaches them', () => {
    expect(who('trades.proposal.received', changed('SEND', 'DRAFT', 'AWAITING_ACCEPTANCE', seller))).toEqual([
      buyer,
    ]);
    expect(
      who(
        'trades.proposal.received',
        changed('CLEAR_REVIEW', 'UNDER_PROPOSAL_REVIEW', 'AWAITING_ACCEPTANCE'),
      ),
    ).toEqual([buyer]);
  });

  it('says nothing to the counterparty while a proposal is held for review or waiting on an invitation', () => {
    expect(
      who('trades.proposal.received', changed('SEND', 'DRAFT', 'UNDER_PROPOSAL_REVIEW', seller)),
    ).toBeNull();
    expect(
      who('trades.proposal.received', changed('SEND', 'DRAFT', 'PENDING_COUNTERPARTY', seller)),
    ).toBeNull();
  });

  it('tells the other party about a counter-proposal, an acceptance, a decline and a cancellation', () => {
    for (const [key, action, from, to] of [
      ['trades.proposal.countered', 'COUNTER_PROPOSE', 'AWAITING_ACCEPTANCE', 'AWAITING_ACCEPTANCE'],
      ['trades.proposal.accepted', 'ACCEPT', 'AWAITING_ACCEPTANCE', 'PENDING_PAYMENT'],
      ['trades.proposal.declined', 'DECLINE', 'AWAITING_ACCEPTANCE', 'DECLINED'],
      ['trades.cancelled', 'CANCEL', 'PENDING_PAYMENT', 'CANCELLED'],
    ] as const) {
      expect(who(key, changed(action, from, to, buyer)), key).toEqual([seller]);
      expect(who(key, changed(action, from, to, seller)), key).toEqual([buyer]);
    }
  });

  it('tells only the initiator that a held proposal was rejected', () => {
    expect(
      who('trades.proposal.rejected', changed('REJECT_REVIEW', 'UNDER_PROPOSAL_REVIEW', 'REJECTED')),
    ).toEqual([seller]);
  });

  it('tells both parties about funding, delivery, expiry and cancelled-and-refunded', () => {
    for (const [key, action, from, to] of [
      ['trades.funded', 'FUND', 'PENDING_PAYMENT', 'FUNDED'],
      ['trades.delivered', 'DELIVERY_SIGNAL', 'SHIPPED', 'INSPECTION'],
      ['trades.expired', 'EXPIRE', 'PENDING_PAYMENT', 'EXPIRED'],
      ['trades.refund.cancelled_refunded', 'REFUND_CANCELLATION', 'FUNDED', 'CANCELLED_REFUNDED'],
    ] as const) {
      expect(who(key, changed(action, from, to))?.sort(), key).toEqual([buyer, seller].sort());
    }
  });

  it('tells the buyer it shipped, and that delivery needs their confirmation', () => {
    expect(who('trades.shipped', changed('BEGIN_CUSTODY', 'FUNDED', 'SHIPPED', seller))).toEqual([buyer]);
    expect(
      who('trades.delivery.unconfirmed', changed('DELIVERY_SIGNAL', 'SHIPPED', 'UNCONFIRMED_DELIVERY')),
    ).toEqual([buyer]);
  });

  it('reports delivery for every route into INSPECTION, and for nothing else', () => {
    for (const action of ['DELIVERY_SIGNAL', 'CONFIRM_RECEIPT', 'GRACE_ELAPSED']) {
      expect(who('trades.delivered', changed(action, 'X', 'INSPECTION')), action).toHaveLength(2);
    }
    expect(who('trades.delivered', changed('DELIVERY_SIGNAL', 'SHIPPED', 'UNCONFIRMED_DELIVERY'))).toBeNull();
  });

  it('tells the seller the money was released, and never the buyer', () => {
    expect(who('trades.settled', changed('SETTLE', 'COMPLETED', 'SETTLED'))).toEqual([seller]);
  });

  it('does not double-notify completion: it is mapped from the completed event, not the state change', () => {
    const fromStateChange = TRADE_NOTIFICATION_PLANS.filter(
      (p) =>
        p.event.eventType === 'trades.trade.state_changed' &&
        (p.applies(changed('COMPLETE', 'INSPECTION', 'COMPLETED')) ||
          p.applies(changed('INSPECTION_ELAPSED', 'INSPECTION', 'COMPLETED'))),
    );
    expect(fromStateChange).toEqual([]);
  });

  it('maps completion by how it happened', () => {
    const confirmed = { tradeId, tradeCode: code, via: 'BUYER_CONFIRMED', completedAt: now };
    const elapsed = { ...confirmed, via: 'INSPECTION_ELAPSED' };
    expect(who('trades.completed.confirmed', confirmed)).toEqual([seller]);
    expect(who('trades.completed.confirmed', elapsed)).toBeNull();
    expect(who('trades.completed.auto_released', elapsed)?.sort()).toEqual([buyer, seller].sort());
    expect(who('trades.completed.auto_released', confirmed)).toBeNull();
  });

  it('routes the extension and overdue and refund events', () => {
    const base = { tradeId, tradeCode: code };
    expect(who('trades.delivery_extension.requested', { ...base, requestedByUserId: seller })).toEqual([
      buyer,
    ]);
    expect(who('trades.delivery_extension.responded', { ...base, decision: 'ACCEPTED' })).toEqual([seller]);
    expect(who('trades.inspection_extension.requested', { ...base })).toEqual([seller]);
    expect(who('trades.inspection_extension.responded', { ...base, decision: 'DECLINED' })).toEqual([buyer]);
    expect(
      who('trades.delivery.overdue', { ...base, status: 'FUNDED', refundRequested: true })?.sort(),
    ).toEqual([buyer, seller].sort());
    expect(who('trades.refund.requested', { ...base, reason: 'DELIVERY_OVERDUE' })?.sort()).toEqual(
      [buyer, seller].sort(),
    );
  });

  it('never invents a recipient for a party who is not on the trade yet', () => {
    const open = { ...parties, buyerUserId: null };
    expect(who('trades.funded', changed('FUND', 'PENDING_PAYMENT', 'FUNDED'), open as never)).toEqual([
      seller,
    ]);
  });

  it('gives each party their own next step', () => {
    const funded = plan('trades.funded');
    const payload = changed('FUND', 'PENDING_PAYMENT', 'FUNDED');
    const [first, second] = audienceFor(funded, payload, parties);
    const steps = new Map([first, second].map((r) => [r!.userId, r!.variables.nextStep]));
    expect(steps.get(buyer)).toMatch(/escrow/i);
    expect(steps.get(seller)).toMatch(/ship/i);
  });

  it('puts the trade code and the deep link in every recipient variable set', () => {
    for (const p of TRADE_NOTIFICATION_PLANS) {
      const payload = samplePayload(p);
      expect(p.applies(payload), p.templateKey).toBe(true);
      const recipients = audienceFor(p, payload, parties);
      expect(recipients.length, p.templateKey).toBeGreaterThan(0);
      for (const r of recipients) {
        expect(r.variables.tradeCode).toBe(code);
        expect(r.variables.link).toBe(tradeDeepLink(code));
      }
    }
  });

  it('names each subscriber once, in the notify.on-<thing> form, with one plan per template key', () => {
    const names = TRADE_NOTIFICATION_PLANS.map((p) => p.subscriber);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^notify\.on-[a-z-]+$/);
    const keys = TRADE_NOTIFICATION_PLANS.map((p) => p.templateKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('the T-093 seams', () => {
  it('names hub arrival and the pickup PIN, and no plan uses them yet', () => {
    expect(T093_SEAMS.map((s) => s.templateKey).sort()).toEqual([
      'trades.hub.arrived',
      'trades.pickup_pin.ready',
    ]);
    for (const seam of T093_SEAMS) {
      expect(TRADE_NOTIFICATION_PLANS.some((p) => p.templateKey === seam.templateKey)).toBe(false);
    }
  });
});
