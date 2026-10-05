import { describe, expect, it } from 'vitest';
import { createScheduleRegistry, type ScheduledJob } from '../../src/platform/scheduler/registry.js';

const job = (name: string, cron = '0 2 * * *'): ScheduledJob => ({
  name,
  cron,
  description: 'test job',
  handler: () => Promise.resolve(0),
});

describe('schedule registry', () => {
  it.each(['trades.auto-complete', 'payouts.daily-sweep', 'a1.b2.c3'])('accepts %s', (name) => {
    const registry = createScheduleRegistry();
    registry.register(job(name));
    expect(registry.get(name)?.name).toBe(name);
  });

  it.each(['trades', 'Trades.x', 'trades.-x', 'trades.x-', 'trades.a--b', 'trades..x', 'trades.x_y'])(
    'rejects the name %s',
    (name) => {
      expect(() => createScheduleRegistry().register(job(name))).toThrow(/not a valid job name/);
    },
  );

  it('rejects an invalid cron', () => {
    expect(() => createScheduleRegistry().register(job('trades.x', '61 * * * *'))).toThrow(/invalid cron/);
  });

  it('rejects a duplicate', () => {
    const registry = createScheduleRegistry();
    registry.register(job('trades.x'));
    expect(() => registry.register(job('trades.x'))).toThrow(/already registered/);
  });

  it('keeps registries independent and lists in registration order', () => {
    const a = createScheduleRegistry();
    const b = createScheduleRegistry();
    a.register(job('m.one'));
    a.register(job('m.two'));
    expect(a.list().map((j) => j.name)).toEqual(['m.one', 'm.two']);
    expect(b.list()).toEqual([]);
  });
});
