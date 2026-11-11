import { describe, expect, it } from 'vitest';
import {
  SELLER_TO_CONFIRM,
  allowedPromises,
  completedSpec,
  detectCategory,
  isRequestSpec,
  parkAvailable,
  requestSpec,
  waitingKeys,
} from '../src/trade/create/request';
import { itemSub, itemTitle } from '../src/trade/format';
import { electronics, fashion } from './support/trade';

describe('detectCategory', () => {
  const standards = [electronics, fashion];
  it('finds Electronics from what the buyer calls the item', () => {
    expect(detectCategory('iPhone 13 Pro 256GB', standards)).toBe('electronics');
    expect(detectCategory('Dell XPS laptop', standards)).toBe('electronics');
  });
  it('finds Fashion & Luxury', () => {
    expect(detectCategory('Nike Air Jordan sneakers', standards)).toBe('fashion');
  });
  it('says nothing when no words match or the category is not offered', () => {
    expect(detectCategory('Antique chair', standards)).toBeUndefined();
    expect(detectCategory('iPhone', [fashion])).toBeUndefined();
    expect(detectCategory('   ', standards)).toBeUndefined();
  });
});

describe('the request spec', () => {
  it('holds the buyer words and waits for every required field', () => {
    const spec = requestSpec(electronics, 'iPhone 13 Pro');
    expect(spec).toEqual({
      requestedItem: 'iPhone 13 Pro',
      brand: SELLER_TO_CONFIRM,
      model: SELLER_TO_CONFIRM,
      condition: SELLER_TO_CONFIRM,
    });
    expect(isRequestSpec(spec)).toBe(true);
    expect(waitingKeys(spec)).toEqual(['brand', 'model', 'condition']);
  });
  it('is named by the buyer words until the seller completes it', () => {
    const spec = requestSpec(electronics, 'iPhone 13 Pro');
    expect(itemTitle(spec)).toBe('iPhone 13 Pro');
    expect(itemSub(spec)).toBeUndefined();
  });
  it('is complete once nothing waits, and its title is the seller', () => {
    const done = completedSpec(requestSpec(electronics, 'iPhone 13 Pro'), {
      fields: { brand: 'Apple', model: 'iPhone 13 Pro', condition: 'Brand new', serial: '3569' },
      delivery: {
        mode: 'COURIER',
        partner: 'SwiftDrop',
        chargeMinor: '350000',
        promise: '5-7',
      },
    });
    expect(waitingKeys(done)).toEqual([]);
    expect(isRequestSpec(done)).toBe(false);
    expect(done.deliveryPartner).toBe('SwiftDrop');
    expect(done.deliveryChargeMinor).toBe('350000');
    expect(done.requestedItem).toBeUndefined();
    expect(itemTitle(done)).toBe('Apple iPhone 13 Pro');
    expect(itemSub(done)).toBe('Brand new · 3569');
  });
  it('keeps the buyer delivery choice the seller does not own', () => {
    const base = { ...requestSpec(electronics, 'Phone'), deliveryMode: 'COURIER', contactPhone: '0803' };
    const done = completedSpec(base, {
      fields: { brand: 'A', model: 'B', condition: 'C' },
      delivery: { mode: 'COURIER', partner: 'X', chargeMinor: '1', promise: '1-3' },
    });
    expect(done.contactPhone).toBe('0803');
    expect(done.deliveryMode).toBe('COURIER');
  });
});

describe('delivery promises', () => {
  it('offers only the ranges the category deadline allows', () => {
    expect(allowedPromises(7).map((p) => p.value)).toEqual(['1-3', '5-7']);
    expect(allowedPromises(15).map((p) => p.value)).toEqual(['1-3', '5-7', '7-10', '10-15']);
    expect(allowedPromises(2)).toEqual([]);
  });
  it('words a range', () => {
    expect(allowedPromises(7)[0]?.label).toBe('1–3 days');
  });
});

describe('Park delivery', () => {
  it('is off until a Park catalogue exists', () => {
    expect(parkAvailable()).toBe(false);
  });
});
