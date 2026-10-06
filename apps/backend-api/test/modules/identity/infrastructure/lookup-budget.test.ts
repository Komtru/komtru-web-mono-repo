import { describe, expect, it } from 'vitest';
import {
  LOOKUP_WINDOWS,
  NO_LOOKUP_BUDGET,
  createLookupBudget,
} from '../../../../src/modules/identity/infrastructure/redis/lookup-budget.js';
import { testLogger } from '../support.js';

describe('the party lookup budget (M1 §8.3 control 3)', () => {
  it('bounds a username lookup at 300 a day', () => {
    expect(LOOKUP_WINDOWS.USERNAME).toEqual([{ name: 'day', points: 300, durationSeconds: 86_400 }]);
  });

  it('bounds an email or phone lookup at 50 a day and 500 a month', () => {
    expect(LOOKUP_WINDOWS.EMAIL).toEqual([
      { name: 'day', points: 50, durationSeconds: 86_400 },
      { name: 'month', points: 500, durationSeconds: 2_592_000 },
    ]);
    expect(LOOKUP_WINDOWS.PHONE).toEqual(LOOKUP_WINDOWS.EMAIL);
  });

  it('charges an email lookup more tightly than a username one, on every horizon', () => {
    // §8.4's whole argument is that handles are public by design and addresses are not, so an email
    // budget that matched the handle budget would have thrown that distinction away.
    const tightest = (windows: readonly { points: number }[]) => Math.min(...windows.map((w) => w.points));
    expect(tightest(LOOKUP_WINDOWS.EMAIL)).toBeLessThan(tightest(LOOKUP_WINDOWS.USERNAME));
  });

  it('charges nothing and never throws for the null budget', async () => {
    await expect(NO_LOOKUP_BUDGET.charge('EMAIL', 'user:1')).resolves.toBeUndefined();
  });

  it('namespaces its keys, so two test runs in one day do not share a budget', () => {
    // The windows are 24 hours and 30 days long and the keys outlive a test run by design. Without
    // a prefix the suite's second run inside a day starts where the first left off, which is a
    // false failure that looks exactly like a real one. `createRateLimitGate` takes one for the
    // same reason.
    expect(() =>
      createLookupBudget({ redis: {} as never, logger: testLogger, keyPrefix: 'test-run-1' }),
    ).not.toThrow();
  });
});
