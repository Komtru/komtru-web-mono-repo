// F-069/F-073: what the stand-in serves for the fulfil, completed and payouts screens, so a visual check of them
// reads the same data every run.
import { describe, expect, it } from 'vitest';

import {
  TRADE_IDS,
  deliveryDeadlineFor,
  payoutSummaryFor,
  payoutsFor,
  shipOptionsFor,
  tradeFor,
  tradesFor,
} from '../src/standin/fixtures.ts';
import { checkFixtures } from '../src/standin/contracts.ts';

describe('the fulfil and payouts fixtures', () => {
  it('parse against the contracts the apps use', () => {
    expect(() => checkFixtures()).not.toThrow();
  });

  it('give the seller two orders to ship, one in inspection and one completed', () => {
    const statuses = tradesFor('seller', 'with-trades').map((trade) => trade.status);
    expect(statuses.filter((status) => status === 'FUNDED')).toHaveLength(2);
    expect(statuses).toContain('INSPECTION');
    expect(statuses).toContain('SETTLED');
    expect(tradeFor('seller', 'with-trades', TRADE_IDS.sellerSettled)?.fees?.sellerProceedsMinor).toBe(
      '42940000',
    );
  });

  it('offers the seller shipping options only on a funded trade, and the deadline that applies to each', () => {
    expect(shipOptionsFor('seller', 'with-trades', TRADE_IDS.sellerFunded)?.options).toHaveLength(2);
    expect(shipOptionsFor('seller', 'with-trades', TRADE_IDS.sellerShipped)).toBeNull();
    expect(deliveryDeadlineFor('seller', 'with-trades', TRADE_IDS.sellerFunded)?.deadline?.dueAt).toBe(
      '2026-11-21T09:00:00.000Z',
    );
    // Once shipped, the deadline is the buyer's delivery window (the deliver & inspect screens read it), not the seller's.
    expect(deliveryDeadlineFor('seller', 'with-trades', TRADE_IDS.sellerShipped)?.deadline?.dueAt).toBe(
      '2026-11-20T18:00:00.000Z',
    );
    expect(deliveryDeadlineFor('seller', 'with-trades', TRADE_IDS.sellerSettled)?.deadline).toBeNull();
  });

  it('give a seller a balance and three paid payouts, and a buyer nothing', () => {
    expect(payoutSummaryFor('seller').availableMinor).toBe('120000000');
    expect(payoutsFor('seller')).toHaveLength(3);
    expect(payoutSummaryFor('buyer').defaultAccount).toBeNull();
    expect(payoutsFor('buyer')).toEqual([]);
  });
});
