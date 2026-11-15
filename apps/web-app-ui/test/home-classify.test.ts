import type { TradeListItem } from '@komtru/shared-types';
import { describe, expect, it } from 'vitest';
import { matchesTradeQuery, splitTrades, tradeCodeOf } from '../src/home/classify';
import { counterparty, id, listItem } from './support/trade';

const row = (n: number, over: Record<string, unknown> = {}): TradeListItem =>
  listItem(n, over) as unknown as TradeListItem;

describe('splitting the caller’s trades for home', () => {
  it('puts what the server asks of you first, whatever its status', () => {
    const toAnswer = row(1, { attention: 'RESPOND_TO_PROPOSAL', status: 'AWAITING_ACCEPTANCE' });
    const toPay = row(2, { attention: 'PAY', status: 'PENDING_PAYMENT' });
    const { attention } = splitTrades([toAnswer, toPay]);
    expect(attention.map((trade) => trade.id)).toEqual([id(1), id(2)]);
  });

  it('keeps open trades that need nothing from you as active, in the order the server gave', () => {
    const held = row(1, { attention: null, status: 'UNDER_PROPOSAL_REVIEW', awaiting: null });
    const shipped = row(2, { attention: null, status: 'PENDING_PAYMENT' });
    const { active, past } = splitTrades([held, shipped]);
    expect(active.map((trade) => trade.id)).toEqual([id(1), id(2)]);
    expect(past).toEqual([]);
  });

  it('files finished trades as past, whether they were declined, cancelled or expired', () => {
    const declined = row(1, { attention: null, status: 'DECLINED' });
    const cancelled = row(2, { attention: null, status: 'CANCELLED' });
    const expired = row(3, { attention: null, status: 'EXPIRED' });
    const { active, past } = splitTrades([declined, cancelled, expired]);
    expect(past.map((trade) => trade.id)).toEqual([id(1), id(2), id(3)]);
    expect(active).toEqual([]);
  });

  it('sends a status this version does not know to active, never to past', () => {
    const { active, past } = splitTrades([row(1, { attention: null, status: 'SOMETHING_NEW' })]);
    expect(active).toHaveLength(1);
    expect(past).toHaveLength(0);
  });

  it('keeps every trade in exactly one group', () => {
    const trades = [
      row(1, { attention: 'PAY', status: 'PENDING_PAYMENT' }),
      row(2, { attention: null, status: 'DRAFT' }),
      row(3, { attention: null, status: 'CANCELLED' }),
    ];
    const { attention, active, past } = splitTrades(trades);
    expect(attention.length + active.length + past.length).toBe(trades.length);
  });
});

describe('matching a search against a trade', () => {
  const trade = row(1, {
    tradeCode: 'KMT-9013800-NG',
    item: { title: 'Bluetooth Speaker', categoryCode: 'electronics', categoryName: 'Electronics' },
    counterparty: counterparty({ displayName: 'Prime Gadgets', username: 'primegadgets' }),
  });

  it('matches the item, its category, and the counterparty by display name or handle', () => {
    expect(matchesTradeQuery(trade, 'speaker')).toBe(true);
    expect(matchesTradeQuery(trade, 'ELECTRONICS')).toBe(true);
    expect(matchesTradeQuery(trade, 'prime gad')).toBe(true);
    expect(matchesTradeQuery(trade, '@primegadgets')).toBe(true);
  });

  it('matches a Trade Code by its digits, with or without the prefix and market suffix', () => {
    expect(matchesTradeQuery(trade, 'KMT-9013800-NG')).toBe(true);
    expect(matchesTradeQuery(trade, 'kmt-9013800')).toBe(true);
    expect(matchesTradeQuery(trade, '9013800')).toBe(true);
    expect(matchesTradeQuery(trade, 'KMT-9013801')).toBe(false);
  });

  it('finds a run of digits that is part of an item name, not only a code', () => {
    const order = row(3, {
      tradeCode: 'KMT-9013900-NG',
      item: { title: 'Order 20231', categoryCode: null, categoryName: null },
      counterparty: null,
    });
    expect(matchesTradeQuery(order, '20231')).toBe(true);
    expect(matchesTradeQuery(order, '9013801')).toBe(false);
  });

  it('matches nothing for a blank query, and nothing it does not contain', () => {
    expect(matchesTradeQuery(trade, '   ')).toBe(false);
    expect(matchesTradeQuery(trade, 'drone')).toBe(false);
  });

  it('does not fail on a trade with no item title or counterparty', () => {
    const bare = row(2, {
      item: { title: null, categoryCode: null, categoryName: null },
      counterparty: null,
    });
    expect(matchesTradeQuery(bare, 'speaker')).toBe(false);
    expect(matchesTradeQuery(bare, bare.tradeCode)).toBe(true);
  });
});

describe('recognising a Trade Code in a typed query', () => {
  it('returns the canonical code for a code in any accepted form', () => {
    expect(tradeCodeOf('kmt-88213')).toBe('KMT-88213-NG');
    expect(tradeCodeOf('  KMT-7398512-ng ')).toBe('KMT-7398512-NG');
  });

  it('returns undefined for anything that is not a Trade Code', () => {
    expect(tradeCodeOf('iphone 13')).toBeUndefined();
    expect(tradeCodeOf('KMT-12')).toBeUndefined();
    expect(tradeCodeOf('')).toBeUndefined();
  });
});
