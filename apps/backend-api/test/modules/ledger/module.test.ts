import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { loadConfig } from '../../../src/config/env.js';
import type { ModuleContext } from '../../../src/platform/module.js';
import { testRedisEnv, testRedisUrl } from '../../support/db-urls.js';
import {
  ledgerModule,
  PROCESS_PAYMENT_WEBHOOK_QUEUE,
  PROCESS_PAYOUT_QUEUE,
  RESOLVE_ACCOUNT_NAME_QUEUE,
  VERIFY_PAYOUT_ACCOUNT_QUEUE,
  VERIFY_CHARGE_QUEUE,
} from '../../../src/modules/ledger/index.js';
import { assertRouteInvariants, routeLabel } from '../../../src/platform/http/route.js';
import { testModules } from '../../support/modules.js';
import { createScheduleRegistry } from '../../../src/platform/scheduler/registry.js';

describe('the ledger module', () => {
  it('is in the registry', () => {
    expect(testModules().map((m) => m.name)).toContain('ledger');
  });

  it('declares the funding surface and the Paystack webhook (T-072)', () => {
    const routes = ledgerModule.routes ?? [];
    expect(routes.map(routeLabel)).toEqual([
      'POST /trades/:code/payment/initiate',
      'POST /trades/:code/payment/confirm',
      'GET /trades/:code/payment/status',
      'POST /webhooks/paystack',
      'GET /payouts/banks',
      'GET /me/payout-accounts',
      'POST /me/payout-accounts',
      'POST /me/payout-accounts/:id/default',
      'DELETE /me/payout-accounts/:id',
      'GET /me/payout-preferences',
      'PUT /me/payout-preferences',
      'GET /me/payouts/summary',
      'GET /me/payouts',
      'GET /me/payouts/:id',
      'POST /me/payouts',
    ]);
    const webhook = routes.find((r) => r.path === '/webhooks/paystack');
    expect(webhook?.scope).toBe('PUBLIC');
    for (const route of routes.filter((r) => r.path.startsWith('/trades'))) {
      expect(route.scope, routeLabel(route)).toBe('CONSUMER');
      if (route.method === 'post') expect(route.retryable, routeLabel(route)).toBe(true);
    }
    expect(() => assertRouteInvariants(routes)).not.toThrow();
  });

  it('puts every payout route behind a session, and keys the withdrawal for retries (T-073)', () => {
    const routes = (ledgerModule.routes ?? []).filter(
      (r) => r.path.startsWith('/me/payout') || r.path.startsWith('/payouts'),
    );
    for (const route of routes) expect(route.scope, routeLabel(route)).toBe('CONSUMER');
    const withdraw = routes.find((r) => routeLabel(r) === 'POST /me/payouts');
    expect(withdraw?.retryable).toBe(true);
    expect(withdraw?.rateLimit).toBeDefined();
  });

  it('consumes the name-resolution and funding queues', () => {
    expect((ledgerModule.queues ?? []).map((q) => q.name)).toEqual([
      RESOLVE_ACCOUNT_NAME_QUEUE,
      VERIFY_CHARGE_QUEUE,
      PROCESS_PAYMENT_WEBHOOK_QUEUE,
      VERIFY_PAYOUT_ACCOUNT_QUEUE,
      PROCESS_PAYOUT_QUEUE,
    ]);
    expect(PROCESS_PAYOUT_QUEUE).toBe('ledger.process-payout');
    expect(RESOLVE_ACCOUNT_NAME_QUEUE).toBe('ledger.resolve-account-name');
  });

  it('registers its schedules cleanly, which is what proves the name and the cron', () => {
    // The registry rejects a name that is not `module.job-name` and a cron BullMQ cannot parse.
    const registry = createScheduleRegistry();
    for (const job of ledgerModule.schedules ?? []) registry.register(job);

    expect(registry.list().map((j) => j.name)).toEqual([
      'ledger.refresh-bank-list',
      'ledger.sweep-payment-webhooks',
      'ledger.sweep-payouts',
      'ledger.sweep-payouts-auto',
    ]);
    // Once a day, at 09:00 in the scheduler's zone — which is Africa/Lagos unless an operator says otherwise.
    expect(registry.get('ledger.sweep-payouts-auto')?.cron).toBe('0 9 * * *');
    const config = loadConfig({
      NODE_ENV: 'test',
      POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
      REDIS_URL: testRedisUrl(),
    });
    expect(config.scheduler.timezone).toBe('Africa/Lagos');
    expect(registry.get('ledger.refresh-bank-list')?.cron).toMatch(/^\S+ \S+ \* \* \*$/);
  });

  const startedContext = () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
      REDIS_URL: testRedisUrl(),
      ...testRedisEnv(),
    });
    const warn = vi.fn();
    const info = vi.fn();
    const error = vi.fn();
    const subscribe = vi.fn();
    const logger = { warn, info, error } as unknown as ModuleContext['logger'];
    const ctx = {
      config,
      logger,
      redis: {} as Redis,
      events: { subscribe } as unknown as ModuleContext['events'],
    } as ModuleContext;
    return { ctx, warn, info, error, subscribe };
  };

  it('says so at boot when Paystack is unconfigured', async () => {
    const { ctx, warn } = startedContext();

    await ledgerModule.start?.(ctx);
    await ledgerModule.stop?.();

    // Otherwise an unset key and an attack look identical in the logs: every signature returns false.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('PAYSTACK_SECRET_KEY'));
  });

  it('answers a completed trade, and only a completed one, with a release (T-074)', async () => {
    const { ctx, error, subscribe } = startedContext();
    await ledgerModule.start?.(ctx);
    await ledgerModule.stop?.();

    interface Subscription {
      name: string;
      event: { eventType: string };
      handler: (envelope: unknown, tx: unknown) => Promise<void>;
    }
    // By name, not by position: another ticket adding a ledger subscription must not fail this.
    const subscription = subscribe.mock.calls
      .map((call) => call[0] as Subscription)
      .find((s) => s.name === 'ledger.on-trade-completed');
    expect(subscription?.event.eventType).toBe('trades.trade.state_changed');

    // A `tx` that answers "no such trade", so the handler runs all the way to a decision without a
    // database. Reaching `releaseEscrow` at all is the thing under test; what it decides on a
    // trade that exists is release.int.test.ts's business.
    const selected = vi.fn(() => Promise.resolve([]));
    const tx = { select: () => ({ from: () => ({ where: () => ({ for: selected }) }) }) };
    const envelope = (to: string) => ({ eventId: randomUUID(), payload: { tradeId: randomUUID(), to } });

    // Every other transition publishes this same event. Settling on one of those would release the
    // escrow of a trade that has not completed, so the filter is tested, not merely written.
    for (const to of ['FUNDED', 'SHIPPED', 'INSPECTION', 'DISPUTED', 'SETTLED', 'CANCELLED_REFUNDED']) {
      await subscription?.handler(envelope(to), tx);
    }
    expect(selected).not.toHaveBeenCalled();

    await subscription?.handler(envelope('COMPLETED'), tx);
    expect(selected).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'NOT_RELEASABLE', reason: 'the trade does not exist' }),
      expect.stringContaining('could not settle'),
    );
  });

  it('subscribes to its own payout request and to escrow releases (T-073)', async () => {
    const { ctx, subscribe } = startedContext();
    await ledgerModule.start?.(ctx);
    await ledgerModule.stop?.();
    const names = subscribe.mock.calls.map(
      (call) => call[0] as { name: string; event: { eventType: string } },
    );
    expect(names.map((s) => [s.name, s.event.eventType])).toEqual(
      expect.arrayContaining([
        ['ledger.on-payout-requested', 'ledger.payout.requested'],
        ['ledger.on-escrow-released', 'ledger.payment.escrow_released'],
      ]),
    );
  });

  it('refuses to run a job before the module started, rather than failing on undefined', async () => {
    const schedule = (ledgerModule.schedules ?? [])[0]!;
    await expect(schedule.handler(new Date())).rejects.toThrow(/ledger module/i);

    const queue = (ledgerModule.queues ?? [])[0]!;
    await expect(
      queue.process(
        { accountNumber: '0123456789', bankCode: '044', provider: 'PAYSTACK' } as never,
        undefined as never,
      ),
    ).rejects.toThrow(/ledger module/i);
  });
});
