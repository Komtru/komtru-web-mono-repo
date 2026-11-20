import { describe, expect, it } from 'vitest';
import { sellLimitWarning } from '../src/trade/create/sellLimit';

// Owner ruling 2026-11-20: ₦200,000 a trade, ₦2,000,000 a day, for an account without merchant status.
const limit = { perTradeMinor: '20000000', perDayMinor: '200000000', remainingTodayMinor: '5000000' };

describe('sellLimitWarning', () => {
  it('says nothing within both limits, for a merchant, or before the platform has answered', () => {
    expect(sellLimitWarning(limit, 5_000_000n)).toBeUndefined();
    expect(sellLimitWarning(null, 10n ** 12n)).toBeUndefined();
    expect(sellLimitWarning(undefined, 10n ** 12n)).toBeUndefined();
    expect(sellLimitWarning(limit, undefined)).toBeUndefined();
  });

  it('names the per-trade limit first when the price is over it', () => {
    const warning = sellLimitWarning(limit, 20_000_001n);
    expect(warning?.title).toBe('Over your ₦200,000 limit per trade');
    expect(warning?.body).toContain('merchant status');
  });

  it("says what is left today when the price is within the trade limit but over today's", () => {
    const warning = sellLimitWarning(limit, 6_000_000n);
    expect(warning?.title).toBe('Over what you can sell today');
    expect(warning?.body).toContain('₦50,000 left today');
    expect(warning?.body).toContain('₦2,000,000 a day');
  });
});
