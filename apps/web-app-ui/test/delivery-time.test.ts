import { describe, expect, it } from 'vitest';
import { deliveryTimeState, overdueWords, reasonLabel } from '../src/trade/delivery-time';

const NOW = new Date('2026-11-11T12:00:00.000Z');
const FUTURE = '2026-11-12T09:00:00.000Z';
const PAST = '2026-11-10T09:00:00.000Z';
const read = (
  dueAt: string,
  over: { status?: string; extensionCount?: number; request?: { id: string; status: string } | null } = {},
) => ({
  deadline: { status: over.status ?? 'PENDING', dueAt, extensionCount: over.extensionCount ?? 0 },
  extensionRequest: over.request ?? null,
});

describe('what the delivery deadline means to each side (DE1 to DE3)', () => {
  it('lets the seller ask before the date passes, until it has been asked once', () => {
    expect(deliveryTimeState(read(FUTURE), 'SELLER', NOW)).toEqual({ kind: 'can-ask' });
    expect(deliveryTimeState(read(FUTURE), 'BUYER', NOW)).toEqual({ kind: 'none' });
    expect(deliveryTimeState(read(FUTURE, { extensionCount: 1 }), 'SELLER', NOW)).toEqual({ kind: 'none' });
    expect(
      deliveryTimeState(read(FUTURE, { request: { id: 'r', status: 'DECLINED' } }), 'SELLER', NOW),
    ).toEqual({ kind: 'request-declined' });
    expect(
      deliveryTimeState(read(FUTURE, { request: { id: 'r', status: 'DECLINED' } }), 'BUYER', NOW),
    ).toEqual({ kind: 'none' });
  });

  it('shows a waiting request to both sides', () => {
    const pending = read(FUTURE, { request: { id: 'r', status: 'PENDING' } });
    expect(deliveryTimeState(pending, 'BUYER', NOW)).toEqual({ kind: 'request-pending' });
    expect(deliveryTimeState(pending, 'SELLER', NOW)).toEqual({ kind: 'request-pending' });
  });

  it('calls it overdue once the date has passed while the deadline is still open, whoever asked', () => {
    expect(deliveryTimeState(read(PAST), 'BUYER', NOW)).toEqual({ kind: 'overdue', dueAt: PAST });
    expect(deliveryTimeState(read(PAST, { request: { id: 'r', status: 'PENDING' } }), 'SELLER', NOW)).toEqual(
      { kind: 'overdue', dueAt: PAST },
    );
  });

  it('says nothing when there is no open deadline', () => {
    expect(deliveryTimeState({ deadline: null, extensionRequest: null }, 'BUYER', NOW)).toEqual({
      kind: 'none',
    });
    expect(deliveryTimeState(read(PAST, { status: 'MET' }), 'BUYER', NOW)).toEqual({ kind: 'none' });
  });

  it('keeps every word about money to what the platform does: protected, and refunded only if nothing shipped', () => {
    expect(overdueWords('BUYER', false, 'yesterday', 'Ada').body).toMatch(
      /stays protected.*refunds you in full/,
    );
    expect(overdueWords('BUYER', true, 'yesterday').body).not.toMatch(/refund/i);
    expect(overdueWords('SELLER', true, 'yesterday').body).toMatch(/Report delivery/);
  });

  it('words the reasons the platform lists, and never invents one', () => {
    expect(reasonLabel('COURIER_PICKUP_DELAYED')).toBe('Courier pickup delayed');
    expect(reasonLabel(undefined)).toBe('Not given');
  });
});
