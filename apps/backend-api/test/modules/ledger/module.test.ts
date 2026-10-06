import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { loadConfig } from '../../../src/config/env.js';
import type { ModuleContext } from '../../../src/platform/module.js';
import { testRedisUrl } from '../../support/db-urls.js';
import { ledgerModule, RESOLVE_ACCOUNT_NAME_QUEUE } from '../../../src/modules/ledger/index.js';
import { testModules } from '../../support/modules.js';
import { createScheduleRegistry } from '../../../src/platform/scheduler/registry.js';

describe('the ledger module', () => {
  it('is in the registry', () => {
    expect(testModules().map((m) => m.name)).toContain('ledger');
  });

  it('declares no routes yet: the funding and payout surfaces are T-072 and T-073', () => {
    expect(ledgerModule.routes ?? []).toEqual([]);
  });

  it('consumes the name-resolution queue', () => {
    expect((ledgerModule.queues ?? []).map((q) => q.name)).toEqual([RESOLVE_ACCOUNT_NAME_QUEUE]);
    expect(RESOLVE_ACCOUNT_NAME_QUEUE).toBe('ledger.resolve-account-name');
  });

  it('registers its schedules cleanly, which is what proves the name and the cron', () => {
    // The registry rejects a name that is not `module.job-name` and a cron BullMQ cannot parse.
    const registry = createScheduleRegistry();
    for (const job of ledgerModule.schedules ?? []) registry.register(job);

    expect(registry.list().map((j) => j.name)).toEqual(['ledger.refresh-bank-list']);
    expect(registry.get('ledger.refresh-bank-list')?.cron).toMatch(/^\S+ \S+ \* \* \*$/);
  });

  it('says so at boot when Paystack is unconfigured', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
      REDIS_URL: testRedisUrl(),
    });
    const warn = vi.fn();
    const logger = { warn, info: vi.fn(), error: vi.fn() } as unknown as ModuleContext['logger'];
    const ctx = { config, logger, redis: {} as Redis } as ModuleContext;

    await ledgerModule.start?.(ctx);
    await ledgerModule.stop?.();

    // Otherwise an unset key and an attack look identical in the logs: every signature returns false.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('PAYSTACK_SECRET_KEY'));
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
