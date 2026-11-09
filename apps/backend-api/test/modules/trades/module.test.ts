/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call -- a vi.fn spy's recorded calls are untyped */
// What the trades module registers with the platform (T-064 adds a schedule and a subscriber).
import { describe, expect, it, vi } from 'vitest';
import { createTradesModule } from '../../../src/modules/trades/module.js';
import { routeLabel } from '../../../src/platform/http/route.js';
import { testConfig, testLogger } from '../identity/support.js';

const module = () =>
  createTradesModule({
    db: {} as never,
    redis: {} as never,
    logger: testLogger,
    config: testConfig({ IDENTITY_HMAC_PEPPER: 'a-pepper-for-tests-0123456789abc' }),
  });

describe('the trades module', () => {
  it('mounts the proposal and the fulfilment routes together', () => {
    const labels = (module().routes ?? []).map(routeLabel);
    expect(labels).toContain('POST /trades/:id/accept');
    expect(labels).toContain('GET /trades/:id/ship-options');
    expect(labels).toContain('POST /trades/:id/delivery-extension');
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('schedules the delivery-deadline sweep every five minutes, for the worker', () => {
    const [job, ...rest] = module().schedules ?? [];
    expect(rest).toEqual([]);
    expect(job).toMatchObject({ name: 'trades.delivery-deadlines', cron: '*/5 * * * *' });
  });

  it('subscribes to state changes to open the delivery deadline on funding', async () => {
    const subscribe = vi.fn();
    await module().start?.({ events: { subscribe }, logger: testLogger } as never);
    const names = subscribe.mock.calls.map(([subscription]) => subscription.name);
    expect(names).toContain('trades.open-delivery-deadline');
    const subscription = subscribe.mock.calls.find(([s]) => s.name === 'trades.open-delivery-deadline')![0];
    expect(subscription.event.eventType).toBe('trades.trade.state_changed');
    // Any other transition is none of its business: it must not touch the database.
    await expect(
      subscription.handler({ payload: { to: 'SHIPPED', tradeId: 'x' } }, {}),
    ).resolves.toBeUndefined();
  });
});
