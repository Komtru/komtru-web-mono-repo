import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ApiClient } from '../../src/client.js';
import { defineEndpoint } from '../../src/contracts.js';
import { ProblemError, readResponseMeta } from '../../src/problems.js';
import { createMemoryQueueStore } from '../../src/queue/memory-store.js';
import { createRetryQueue, queueRetryDelayMs } from '../../src/queue/retry-queue.js';
import type { QueueEvent } from '../../src/queue/types.js';

const receiveParcel = defineEndpoint({
  method: 'post',
  path: '/park/parcels/:id/receive',
  scope: 'LOGISTICS',
  retryable: true,
  schema: { params: z.object({ id: z.string() }), response: z.object({ ok: z.boolean() }) },
});

const releaseParcel = defineEndpoint({
  method: 'post',
  path: '/park/parcels/:id/release',
  scope: 'LOGISTICS',
  retryable: true,
  schema: { params: z.object({ id: z.string() }), response: z.object({ ok: z.boolean() }) },
});

const logParcel = defineEndpoint({
  method: 'post',
  path: '/park/parcels/:id/log',
  scope: 'LOGISTICS',
  // The backend decided a repeat is harmless, so there is no key and nothing to replay safely.
  retryable: false,
  schema: { params: z.object({ id: z.string() }), response: z.object({ ok: z.boolean() }) },
});

const endpoints = { receiveParcel, releaseParcel, logParcel };

const problem = (status: number, code: string) =>
  new ProblemError(
    { type: 'about:blank', title: code, status, code },
    readResponseMeta(new Headers(), status),
    false,
  );

interface Sent {
  endpoint: string;
  input: unknown;
  idempotencyKey: string | undefined;
}

const fakeClient = (reply: (sent: Sent, call: number) => unknown) => {
  const sent: Sent[] = [];
  const call = vi.fn((endpoint: { path: string }, input: unknown, options?: { idempotencyKey?: string }) => {
    const record: Sent = {
      endpoint: endpoint.path,
      input,
      idempotencyKey: options?.idempotencyKey,
    };
    sent.push(record);
    try {
      return Promise.resolve(reply(record, sent.length));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
  return { sent, client: { call } as unknown as ApiClient };
};

describe('createRetryQueue', () => {
  let events: QueueEvent[];

  beforeEach(() => {
    events = [];
  });

  const queueWith = (client: ApiClient, maxAttempts?: number) =>
    createRetryQueue({
      client,
      endpoints,
      store: createMemoryQueueStore(),
      onEvent: (event) => events.push(event),
      ...(maxAttempts === undefined ? {} : { maxAttempts }),
    });

  it('replays in enqueue order, each with the key it was given at enqueue', async () => {
    const { sent, client } = fakeClient(() => ({ ok: true }));
    const queue = queueWith(client);

    const a = await queue.enqueue('receiveParcel', { params: { id: 'p1' } });
    const b = await queue.enqueue('receiveParcel', { params: { id: 'p2' } });
    const c = await queue.enqueue('releaseParcel', { params: { id: 'p1' } });

    await queue.flush();

    expect(sent.map((item) => item.endpoint)).toEqual([
      '/park/parcels/:id/receive',
      '/park/parcels/:id/receive',
      '/park/parcels/:id/release',
    ]);
    expect(sent.map((item) => item.idempotencyKey)).toEqual([
      a.idempotencyKey,
      b.idempotencyKey,
      c.idempotencyKey,
    ]);
    expect(await queue.pending()).toEqual([]);
  });

  it('stops at the head on a retryable failure, so a receive can never overtake a release', async () => {
    const { sent, client } = fakeClient((item) => {
      if (item.input && (item.input as { params: { id: string } }).params.id === 'p2') {
        throw problem(503, 'INTERNAL');
      }
      return { ok: true };
    });
    const queue = queueWith(client);

    await queue.enqueue('receiveParcel', { params: { id: 'p1' } });
    await queue.enqueue('receiveParcel', { params: { id: 'p2' } });
    await queue.enqueue('releaseParcel', { params: { id: 'p3' } });

    await queue.flush();

    expect(sent).toHaveLength(2);
    const pending = await queue.pending();
    expect(pending.map((entry) => (entry.input as { params: { id: string } }).params.id)).toEqual([
      'p2',
      'p3',
    ]);
    expect(pending[0]?.attempts).toBe(1);
    expect(events.some((event) => event.type === 'retrying')).toBe(true);
  });

  it('replays a blocked entry with the same key once the connection comes back', async () => {
    let fail = true;
    const { sent, client } = fakeClient(() => {
      if (fail) throw problem(503, 'INTERNAL');
      return { ok: true };
    });
    const queue = queueWith(client);
    const entry = await queue.enqueue('receiveParcel', { params: { id: 'p1' } });

    await queue.flush();
    fail = false;
    await queue.flush();

    expect(sent.map((item) => item.idempotencyKey)).toEqual([entry.idempotencyKey, entry.idempotencyKey]);
    expect(await queue.pending()).toEqual([]);
  });

  it('drops an entry a repeat can never fix and keeps going', async () => {
    const { sent, client } = fakeClient((item) => {
      if ((item.input as { params: { id: string } }).params.id === 'p2') {
        throw problem(422, 'IDEMPOTENCY_KEY_REUSED');
      }
      return { ok: true };
    });
    const queue = queueWith(client);

    await queue.enqueue('receiveParcel', { params: { id: 'p1' } });
    await queue.enqueue('receiveParcel', { params: { id: 'p2' } });
    await queue.enqueue('releaseParcel', { params: { id: 'p3' } });

    await queue.flush();

    expect(sent.map((item) => (item.input as { params: { id: string } }).params.id)).toEqual([
      'p1',
      'p2',
      'p3',
    ]);
    expect(await queue.pending()).toEqual([]);
    const dropped = events.filter((event) => event.type === 'dropped');
    expect(dropped).toHaveLength(1);
  });

  it('drops an entry that has used up its attempts', async () => {
    const { client } = fakeClient(() => {
      throw problem(503, 'INTERNAL');
    });
    const queue = queueWith(client, 2);
    await queue.enqueue('receiveParcel', { params: { id: 'p1' } });

    await queue.flush();
    expect(await queue.pending()).toHaveLength(1);
    await queue.flush();

    expect(await queue.pending()).toEqual([]);
    expect(events.filter((event) => event.type === 'dropped')).toHaveLength(1);
  });

  it('refuses to queue a call the backend did not mark retryable', async () => {
    const { client } = fakeClient(() => ({ ok: true }));
    const queue = queueWith(client);
    await expect(queue.enqueue('logParcel', { params: { id: 'p1' } })).rejects.toThrow(TypeError);
  });

  it('refuses to queue an endpoint it does not know', async () => {
    const { client } = fakeClient(() => ({ ok: true }));
    const queue = queueWith(client);
    await expect(queue.enqueue('nope', {})).rejects.toThrow(TypeError);
  });

  it('runs one flush at a time', async () => {
    const { sent, client } = fakeClient(() => ({ ok: true }));
    const queue = queueWith(client);
    await queue.enqueue('receiveParcel', { params: { id: 'p1' } });
    await queue.enqueue('receiveParcel', { params: { id: 'p2' } });

    await Promise.all([queue.flush(), queue.flush()]);

    expect(sent).toHaveLength(2);
  });

  it('adopts a key that was already used, so a direct call can be handed to the queue', async () => {
    const { sent, client } = fakeClient(() => ({ ok: true }));
    const queue = queueWith(client);
    await queue.enqueue('receiveParcel', { params: { id: 'p1' } }, { idempotencyKey: 'park-release-01' });
    await queue.flush();
    expect(sent[0]?.idempotencyKey).toBe('park-release-01');
  });

  it('reports what it sent', async () => {
    const { client } = fakeClient(() => ({ ok: true }));
    const queue = queueWith(client);
    await queue.enqueue('receiveParcel', { params: { id: 'p1' } });
    await queue.flush();
    expect(events.map((event) => event.type)).toEqual(['enqueued', 'sent', 'idle']);
  });
});

describe('queueRetryDelayMs', () => {
  const entry = (attempts: number) => ({
    id: 'e1',
    seq: 1,
    endpoint: 'receiveParcel',
    input: {},
    idempotencyKey: 'key-for-entry-1',
    enqueuedAt: 0,
    attempts,
  });

  it('backs off further the longer an entry has been stuck', () => {
    const noJitter = () => 1;
    expect(queueRetryDelayMs(entry(1), problem(503, 'INTERNAL'), noJitter)).toBe(300);
    expect(queueRetryDelayMs(entry(2), problem(503, 'INTERNAL'), noJitter)).toBe(600);
    expect(queueRetryDelayMs(entry(3), problem(503, 'INTERNAL'), noJitter)).toBe(1_200);
  });

  it('obeys a Retry-After the server can afford to wait out', () => {
    const rateLimited = new ProblemError(
      { type: 'about:blank', title: 'RATE_LIMITED', status: 429, code: 'RATE_LIMITED' },
      readResponseMeta(new Headers({ 'Retry-After': '5' }), 429),
      false,
    );
    expect(queueRetryDelayMs(entry(1), rateLimited)).toBe(5_000);
  });
});
