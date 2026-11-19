// The module's wiring, checked without starting a process. The scheduler validates job names at
// boot and throws on a bad one, so the point of these is to fail here rather than at deploy.
//
// The colon assertion is not theoretical: BullMQ uses `:` as its own key separator and rejects a
// custom job id containing one, and a stubbed queue in a test will not catch it — only a real
// Redis path will. Since this module's schedules are the only ids it creates, the cheapest guard
// is to refuse a colon anywhere in a name at all.
import { describe, expect, it } from 'vitest';
import { createDisputesModule } from '../../../src/modules/disputes/module.js';
import { SWEEP_CRON } from '../../../src/modules/disputes/jobs/deadlines.job.js';

const module = createDisputesModule();

describe('the disputes module', () => {
  it('is named for its schema', () => {
    expect(module.name).toBe('disputes');
  });

  it('builds its route table without a running process', () => {
    expect(module.routes?.length).toBeGreaterThan(0);
  });

  it('refuses to serve a request before start()', () => {
    const route = module.routes?.find((r) => r.path === '/disputes');
    expect(route).toBeDefined();
    // The handler reaches for the database through a thunk, so it throws rather than closing over
    // a connection that does not exist yet.
    expect(() => route?.handler({ query: {}, actor: {} } as never)).toThrow(/before start/i);
  });

  it('schedules one sweep per clock', () => {
    expect(module.schedules?.map((job) => job.name)).toEqual([
      'disputes.mediation-deadlines',
      'disputes.evidence-deadlines',
      'disputes.appeal-deadlines',
    ]);
  });

  it('names every schedule module.job-name, with no colon anywhere', () => {
    for (const job of module.schedules ?? []) {
      expect(job.name).toMatch(/^disputes\.[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
      expect(job.name).not.toContain(':');
      expect(job.description.length).toBeGreaterThan(0);
    }
  });

  it('runs every sweep at the resolution a deadline is promised to', () => {
    for (const job of module.schedules ?? []) expect(job.cron).toBe(SWEEP_CRON);
  });

  it('starts and stops cleanly', async () => {
    await expect(module.stop?.()).resolves.toBeUndefined();
  });
});
