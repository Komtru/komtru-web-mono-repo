// The default store. Good enough for an app that only wants in-session resilience; `park-agent-app`
// swaps in the IndexedDB one so a queued release survives the phone being locked.
import type { NewQueuedRequest, QueuedRequest, QueueStore } from './types.js';

export function createMemoryQueueStore(): QueueStore {
  const entries = new Map<string, QueuedRequest>();
  let seq = 0;

  return {
    add: (entry: NewQueuedRequest) => {
      seq += 1;
      const stored: QueuedRequest = { ...entry, seq };
      entries.set(stored.id, stored);
      return Promise.resolve(stored);
    },
    list: () => Promise.resolve([...entries.values()].sort((a, b) => a.seq - b.seq)),
    update: (entry: QueuedRequest) => {
      // Only if it is still there: a flush that dropped an entry must not resurrect it.
      if (entries.has(entry.id)) entries.set(entry.id, entry);
      return Promise.resolve();
    },
    remove: (id: string) => {
      entries.delete(id);
      return Promise.resolve();
    },
    clear: () => {
      entries.clear();
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };
}
