// A real IndexedDB implementation, not a stub of the store's own interface: the ordering guarantee
// the queue depends on is IndexedDB's autoIncrement key, so only IndexedDB can prove it.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIndexedDbQueueStore, isIndexedDbAvailable } from '../../src/browser.js';
import type { QueueStore } from '../../src/queue/types.js';

const entry = (id: string) => ({
  id,
  endpoint: 'receiveParcel',
  input: { params: { id } },
  idempotencyKey: `key-${id}-padding`,
  enqueuedAt: 1_790_000_000_000,
  attempts: 0,
});

describe('createIndexedDbQueueStore', () => {
  let databaseName: string;
  let store: QueueStore;

  beforeEach(() => {
    databaseName = `komtru-queue-${String(Math.random()).slice(2)}`;
    store = createIndexedDbQueueStore({ databaseName });
  });

  afterEach(async () => {
    await store.clear();
    await store.close();
  });

  it('assigns an increasing seq and lists in that order', async () => {
    const first = await store.add(entry('p1'));
    const second = await store.add(entry('p2'));
    const third = await store.add(entry('p3'));

    expect(second.seq).toBeGreaterThan(first.seq);
    expect(third.seq).toBeGreaterThan(second.seq);
    expect((await store.list()).map((item) => item.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('keeps the order across a reload of the app', async () => {
    await store.add(entry('p1'));
    await store.add(entry('p2'));
    await store.close();

    const reopened = createIndexedDbQueueStore({ databaseName });
    expect((await reopened.list()).map((item) => item.id)).toEqual(['p1', 'p2']);
    await reopened.close();
    store = createIndexedDbQueueStore({ databaseName });
  });

  it('records another attempt without losing the idempotency key', async () => {
    const added = await store.add(entry('p1'));
    await store.update({ ...added, attempts: 3, lastError: '503' });

    const [stored] = await store.list();
    expect(stored?.attempts).toBe(3);
    expect(stored?.idempotencyKey).toBe(added.idempotencyKey);
    expect(stored?.seq).toBe(added.seq);
  });

  it('removes one entry by id and clears them all', async () => {
    const first = await store.add(entry('p1'));
    await store.add(entry('p2'));

    await store.remove(first.id);
    expect((await store.list()).map((item) => item.id)).toEqual(['p2']);

    await store.clear();
    expect(await store.list()).toEqual([]);
  });
});

describe('isIndexedDbAvailable', () => {
  it('is true where IndexedDB exists', () => {
    expect(isIndexedDbAvailable()).toBe(true);
  });
});
