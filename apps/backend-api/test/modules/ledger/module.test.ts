import { describe, expect, it } from 'vitest';
import { ledgerModule, RESOLVE_ACCOUNT_NAME_QUEUE } from '../../../src/modules/ledger/index.js';
import { modules } from '../../../src/modules/index.js';
import { createScheduleRegistry } from '../../../src/platform/scheduler/registry.js';

describe('the ledger module', () => {
  it('is in the registry', () => {
    expect(modules.map((m) => m.name)).toContain('ledger');
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
