import { describe, expect, it } from 'vitest';
import { SOLD_TRADE_STATUSES, TRADE_STATUSES, viewerFactsSchema } from '../src/index.js';

describe('viewerFactsSchema', () => {
  it('reads the two facts the shell is drawn from', () => {
    expect(viewerFactsSchema.parse({ hasSold: true, certifiedMerchant: false })).toEqual({
      hasSold: true,
      certifiedMerchant: false,
    });
  });

  it('refuses a missing or non-boolean fact rather than guessing one', () => {
    expect(viewerFactsSchema.safeParse({ hasSold: true }).success).toBe(false);
    expect(viewerFactsSchema.safeParse({ hasSold: 'yes', certifiedMerchant: false }).success).toBe(false);
  });

  it('drops a field it does not know, so a platform that grows one does not break the shell', () => {
    expect(viewerFactsSchema.parse({ hasSold: false, certifiedMerchant: true, extra: 1 })).toEqual({
      hasSold: false,
      certifiedMerchant: true,
    });
  });
});

describe('SOLD_TRADE_STATUSES', () => {
  it('is exactly the statuses in which the money reached the seller', () => {
    expect([...SOLD_TRADE_STATUSES]).toEqual(['COMPLETED', 'SETTLED', 'RESOLVED_RELEASED']);
    for (const status of SOLD_TRADE_STATUSES) expect(TRADE_STATUSES).toContain(status);
  });
});
