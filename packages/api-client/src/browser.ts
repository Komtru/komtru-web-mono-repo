// `@komtru/api-client/browser`: the one entry point that touches a browser-only API. Nothing here
// is imported by `@komtru/api-client`, so a React Server Component that imports the client never
// pulls IndexedDB into a Node process.
import type { NewQueuedRequest, QueuedRequest, QueueStore } from './queue/types.js';

export const QUEUE_DATABASE_NAME = 'komtru-retry-queue';
const STORE_NAME = 'requests';
const DATABASE_VERSION = 1;

export const isIndexedDbAvailable = (): boolean =>
  typeof globalThis.indexedDB !== 'undefined' && globalThis.indexedDB !== null;

const promisify = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The IndexedDB request failed'));
  });

export interface IndexedDbQueueStoreOptions {
  databaseName?: string;
}

export function createIndexedDbQueueStore({
  databaseName = QUEUE_DATABASE_NAME,
}: IndexedDbQueueStoreOptions = {}): QueueStore {
  if (!isIndexedDbAvailable()) {
    throw new Error('IndexedDB is not available here; use createMemoryQueueStore() instead');
  }

  let opening: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = globalThis.indexedDB.open(databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        // `seq` is the key and IndexedDB assigns it: that is where the replay order comes from, and
        // it survives a reload, which a counter in memory would not.
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'seq', autoIncrement: true });
          objectStore.createIndex('id', 'id', { unique: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('The retry queue database would not open'));
      // A version bump while another tab holds the old connection open: fail rather than hang.
      request.onblocked = () =>
        reject(new Error('The retry queue database is open in another tab; close it and retry'));
    });
    return opening;
  };

  const withStore = async <T>(
    mode: IDBTransactionMode,
    run: (objectStore: IDBObjectStore) => Promise<T>,
  ): Promise<T> => {
    const db = await open();
    const transaction = db.transaction(STORE_NAME, mode);
    const result = await run(transaction.objectStore(STORE_NAME));
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('The retry queue write failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('The retry queue write aborted'));
    });
    return result;
  };

  const keyOf = async (objectStore: IDBObjectStore, id: string): Promise<IDBValidKey | undefined> =>
    promisify(objectStore.index('id').getKey(id));

  return {
    add: (entry: NewQueuedRequest) =>
      withStore('readwrite', async (objectStore) => {
        const seq = await promisify(objectStore.add(entry));
        return { ...entry, seq: Number(seq) };
      }),

    // `getAll` on an autoIncrement keyPath comes back in key order, which is enqueue order.
    list: () =>
      withStore('readonly', (objectStore) => promisify(objectStore.getAll() as IDBRequest<QueuedRequest[]>)),

    update: (entry: QueuedRequest) =>
      withStore('readwrite', async (objectStore) => {
        // Only if the row is still there: `put` would otherwise resurrect an entry a flush dropped.
        const existing = await promisify(objectStore.get(entry.seq) as IDBRequest<QueuedRequest | undefined>);
        if (existing) await promisify(objectStore.put(entry));
      }),

    remove: (id: string) =>
      withStore('readwrite', async (objectStore) => {
        const key = await keyOf(objectStore, id);
        if (key !== undefined) await promisify(objectStore.delete(key));
      }),

    clear: () => withStore('readwrite', async (objectStore) => void (await promisify(objectStore.clear()))),

    close: async () => {
      if (!opening) return;
      const db = await opening;
      db.close();
      opening = null;
    },
  };
}
