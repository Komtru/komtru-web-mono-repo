// Pure rules behind `GET /trades` (T-068 follow-up): what needs your attention, the row's title, and the
// cursor, which must fail loudly rather than restart at page 1 (T-052's and T-107's review finding).
import { describe, expect, it } from 'vitest';
import { encodeCursor } from '../../../../src/platform/http/paginate.js';
import {
  attentionFor,
  itemTitle,
  readTradeListCursor,
  tradeListCursor,
} from '../../../../src/modules/trades/domain/tradeList.js';

const none = { pendingDeliveryExtension: false, pendingInspectionExtension: false };
const facts = (o: Partial<Parameters<typeof attentionFor>[0]>) => ({
  status: 'AWAITING_ACCEPTANCE' as const,
  yourRole: 'BUYER' as const,
  awaiting: null,
  ...none,
  ...o,
});

describe('attentionFor', () => {
  it('asks the party whose turn it is to answer a proposal', () => {
    expect(attentionFor(facts({ awaiting: 'YOU' }))).toBe('RESPOND_TO_PROPOSAL');
    expect(attentionFor(facts({ awaiting: 'COUNTERPARTY' }))).toBeNull();
  });

  it('asks the buyer to pay, the seller to ship, the buyer to confirm and inspect', () => {
    expect(attentionFor(facts({ status: 'PENDING_PAYMENT', yourRole: 'BUYER' }))).toBe('PAY');
    expect(attentionFor(facts({ status: 'PENDING_PAYMENT', yourRole: 'SELLER' }))).toBeNull();
    expect(attentionFor(facts({ status: 'FUNDED', yourRole: 'SELLER' }))).toBe('SHIP');
    expect(attentionFor(facts({ status: 'FUNDED', yourRole: 'BUYER' }))).toBeNull();
    expect(attentionFor(facts({ status: 'UNCONFIRMED_DELIVERY', yourRole: 'BUYER' }))).toBe(
      'CONFIRM_DELIVERY',
    );
    expect(attentionFor(facts({ status: 'INSPECTION', yourRole: 'BUYER' }))).toBe('INSPECT');
    expect(attentionFor(facts({ status: 'INSPECTION', yourRole: 'SELLER' }))).toBeNull();
  });

  it('asks the buyer about a delivery extension and the seller about an inspection extension', () => {
    expect(attentionFor(facts({ status: 'FUNDED', yourRole: 'BUYER', pendingDeliveryExtension: true }))).toBe(
      'RESPOND_TO_EXTENSION',
    );
    expect(
      attentionFor(facts({ status: 'FUNDED', yourRole: 'SELLER', pendingDeliveryExtension: true })),
    ).toBe('SHIP');
    expect(
      attentionFor(facts({ status: 'INSPECTION', yourRole: 'SELLER', pendingInspectionExtension: true })),
    ).toBe('RESPOND_TO_EXTENSION');
  });

  it('asks nothing of anyone on a trade that is finished or waiting on someone else', () => {
    for (const status of [
      'SETTLED',
      'CANCELLED',
      'DECLINED',
      'EXPIRED',
      'PENDING_COUNTERPARTY',
      'SHIPPED',
    ] as const) {
      for (const yourRole of ['BUYER', 'SELLER'] as const) {
        expect(attentionFor(facts({ status, yourRole })), `${status} ${yourRole}`).toBeNull();
      }
    }
  });
});

describe('itemTitle', () => {
  it('takes the first of title, name, model, brand that is a non-blank string, trimmed and bounded', () => {
    expect(itemTitle({ title: '  iPhone 13  ', name: 'x' })).toBe('iPhone 13');
    expect(itemTitle({ name: 5, model: 'Galaxy S22' })).toBe('Galaxy S22');
    expect(itemTitle({ brand: 'Tecno' })).toBe('Tecno');
    expect(itemTitle({ title: 'a'.repeat(200) })).toHaveLength(80);
  });

  it('is null when there is nothing to show, whatever shape the details are', () => {
    expect(itemTitle({ title: '   ' })).toBeNull();
    expect(itemTitle({})).toBeNull();
    expect(itemTitle(null)).toBeNull();
    expect(itemTitle('text')).toBeNull();
    expect(itemTitle([1])).toBeNull();
  });
});

describe('the list cursor', () => {
  const row = { cursorTs: '2026-11-09T10:00:00.123456Z', id: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f0001' };

  it('round-trips, keeping microseconds, and is bound to the filter it was issued for', () => {
    const key = tradeListCursor(row, 'OPEN');
    expect(readTradeListCursor(key, 'OPEN')).toEqual({ ts: row.cursorTs, id: row.id });
  });

  it('is absent on the first page', () => {
    expect(readTradeListCursor(undefined, 'ALL')).toBeUndefined();
  });

  it.each([
    ['an empty key', {}],
    ['a missing id', { t: row.cursorTs, f: 'ALL' }],
    ['a missing time', { id: row.id, f: 'ALL' }],
    ['a missing filter', { t: row.cursorTs, id: row.id }],
    ['a time with no microseconds', { t: '2026-11-09T10:00:00Z', id: row.id, f: 'ALL' }],
    ['a time that is not a time', { t: 'yesterday', id: row.id, f: 'ALL' }],
    ['an id that is not a uuid', { t: row.cursorTs, id: "x' OR 1=1", f: 'ALL' }],
    ['a numeric id', { t: row.cursorTs, id: 7, f: 'ALL' }],
    ['an unknown filter', { t: row.cursorTs, id: row.id, f: 'EVERYTHING' }],
    ['a cursor from another filter', { t: row.cursorTs, id: row.id, f: 'CLOSED' }],
    ['a cursor from another list (a cases cursor)', { d: '2026-11-09T10:00:00.000Z', id: row.id }],
    ['an extra field', { t: row.cursorTs, id: row.id, f: 'ALL', userId: 'someone-else' }],
  ])('refuses %s with a 422, never a restart at page 1', (_name, key) => {
    expect(() => readTradeListCursor(key as never, 'ALL')).toThrowError(
      expect.objectContaining({ status: 422 }) as Error,
    );
  });

  it('encodes to something the platform decodes back to the same key', () => {
    const key = tradeListCursor(row, 'ALL');
    expect(JSON.parse(Buffer.from(encodeCursor(key), 'base64url').toString())).toEqual(key);
  });
});
