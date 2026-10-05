// The durable retry queue's storage contract. Storage is pluggable so the ordering rules can be
// tested against a plain object and run against IndexedDB in the browser (`@komtru/api-client/browser`).

export interface QueuedRequest {
  id: string;
  /** Assigned by the store, strictly increasing. This, and only this, is the replay order. */
  seq: number;
  /** A name in the queue's endpoint registry, not a path: the registry is what re-types it. */
  endpoint: string;
  input: unknown;
  /** Minted once, at enqueue, and sent unchanged on every replay however much later. */
  idempotencyKey: string;
  enqueuedAt: number;
  attempts: number;
  lastError?: string;
}

/** What the store receives; `seq` is the store's to assign. */
export type NewQueuedRequest = Omit<QueuedRequest, 'seq'>;

export interface QueueStore {
  add: (entry: NewQueuedRequest) => Promise<QueuedRequest>;
  /** Ascending `seq`. */
  list: () => Promise<QueuedRequest[]>;
  update: (entry: QueuedRequest) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
  close: () => Promise<void>;
}

export type QueueEvent =
  | { type: 'enqueued'; entry: QueuedRequest }
  | { type: 'sent'; entry: QueuedRequest; data: unknown }
  /** A failure a repeat can fix: the entry stays at the head and nothing behind it moves. */
  | { type: 'retrying'; entry: QueuedRequest; error: unknown }
  /** A failure a repeat cannot fix, or one attempt too many: the entry is gone and the UI must say so. */
  | { type: 'dropped'; entry: QueuedRequest; error: unknown }
  | { type: 'idle' };
