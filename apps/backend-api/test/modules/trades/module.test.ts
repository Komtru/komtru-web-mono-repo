/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call -- a vi.fn spy's recorded calls are untyped */
// What the trades module registers with the platform (T-064 adds a schedule and a subscriber).
import { describe, expect, it, vi } from 'vitest';
import { createTradesModule } from '../../../src/modules/trades/module.js';
import { TRADE_PUSHES } from '../../../src/modules/trades/infrastructure/realtime.js';
import { routeLabel } from '../../../src/platform/http/route.js';
import { testConfig, testLogger } from '../identity/support.js';

const gateway = () => ({
  registerRoomAuthorizer: vi.fn(),
  emitToRoom: vi.fn(),
  emitToUser: vi.fn(),
  disconnectUser: vi.fn(),
  connectionCount: () => 0,
});

const module = (g = gateway()) =>
  createTradesModule({
    gateway: g,
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

  it('mounts the inspection routes too', () => {
    const labels = (module().routes ?? []).map(routeLabel);
    expect(labels).toContain('GET /trades/:id/inspection');
    expect(labels).toContain('POST /trades/:id/accept-inspection');
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('mounts the viewer facts read the app shell is drawn from (F-037)', () => {
    const labels = (module().routes ?? []).map(routeLabel);
    expect(labels).toContain('GET /me/viewer');
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('schedules the delivery, inspection and grace sweeps every five minutes, for the worker', () => {
    const jobs = (module().schedules ?? []).filter((job) => job.name !== 'trades.inspection-reminders');
    expect(jobs.map((job) => job.name).sort()).toEqual([
      'trades.delivery-deadlines',
      'trades.grace-deadlines',
      'trades.inspection-deadlines',
    ]);
    for (const job of jobs) expect(job.cron).toBe('*/5 * * * *');
  });

  it('schedules the inspection reminder sweep every fifteen minutes (T-068)', () => {
    const job = (module().schedules ?? []).find((j) => j.name === 'trades.inspection-reminders');
    expect(job?.cron).toBe('*/15 * * * *');
  });

  it('subscribes to the ledger releasing escrow, to settle the trade', async () => {
    const subscribe = vi.fn();
    await module().start?.({ events: { subscribe }, logger: testLogger } as never);
    const subscription = subscribe.mock.calls.find(([s]) => s.name === 'trades.on-escrow-released')![0];
    expect(subscription.event.eventType).toBe('ledger.payment.escrow_released');
    expect(subscription.event.version).toBe(1);
  });

  it('subscribes to the ledger funding escrow, to move the trade to FUNDED (F-024)', async () => {
    const subscribe = vi.fn();
    await module().start?.({ events: { subscribe }, logger: testLogger } as never);
    const subscription = subscribe.mock.calls.find(([s]) => s.name === 'trades.on-escrow-funded')![0];
    expect(subscription.event.eventType).toBe('ledger.payment.escrow_funded');
    expect(subscription.event.version).toBe(1);
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

  it('claims the trade room prefix with an authorizer when it starts, and subscribes every push', async () => {
    const g = gateway();
    const subscribe = vi.fn();
    await module(g).start?.({ events: { subscribe }, logger: testLogger } as never);
    expect(g.registerRoomAuthorizer).toHaveBeenCalledWith('trade', expect.any(Function));
    const names = subscribe.mock.calls.map(([subscription]) => subscription.name);
    for (const push of TRADE_PUSHES) expect(names).toContain(push.subscriber);
  });

  it('does not claim the room before it starts', () => {
    const g = gateway();
    module(g);
    expect(g.registerRoomAuthorizer).not.toHaveBeenCalled();
  });
});
