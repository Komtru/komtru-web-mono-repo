// The queue and schedule names, asserted because two of the rules they must satisfy are invisible
// from the call site: BullMQ's key separator, and the scheduler registry's name grammar.
import { describe, expect, it } from 'vitest';
import { FILES_QUEUES, FILES_SCHEDULES } from '../../../../src/modules/files/domain/queues.js';
import { createScheduleRegistry } from '../../../../src/platform/scheduler/registry.js';

const names = [...Object.values(FILES_QUEUES), ...Object.values(FILES_SCHEDULES)];

describe('files queue and schedule names', () => {
  it('uses no colon anywhere', () => {
    // BullMQ's own key separator. A custom job id containing one is rejected outright, and a stubbed
    // queue in a test will not catch it — only a real-Redis path will.
    for (const name of names) expect(name).not.toContain(':');
  });

  it('namespaces everything under the module', () => {
    for (const name of names) expect(name.startsWith('files.')).toBe(true);
  });

  it('is accepted by the platform scheduler registry', () => {
    // The registry refuses a bad name at boot rather than silently never firing.
    const registry = createScheduleRegistry();
    for (const name of Object.values(FILES_SCHEDULES)) {
      expect(() =>
        registry.register({ name, cron: '0 * * * *', description: 'test', handler: () => Promise.resolve() }),
      ).not.toThrow();
    }
  });

  it('declares distinct names', () => {
    expect(new Set(names).size).toBe(names.length);
  });
});
