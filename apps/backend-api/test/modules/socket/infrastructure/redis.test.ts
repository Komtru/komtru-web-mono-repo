// The adapter pair's close path, against a Redis that is not there.
//
// This needs no running Redis on purpose: port 1 is refused instantly on every platform the repo
// builds on, which is the exact condition the repo workflow's unfiltered step used to run in —
// it had no Redis service, so every `redis://localhost:56379` in the backend suite was a refused
// connection, and the socket module's teardown never returned.
import { describe, expect, it } from 'vitest';
import { createAdapterConnections } from '../../../../src/modules/socket/infrastructure/redis.js';

/** Refused on connect, and never anything else. */
const UNREACHABLE = 'redis://127.0.0.1:1';

/** Longer than ioredis's retry backoff reaches here, so a client still looping would show it. */
const WATCH_MS = 800;

describe('the socket adapter connections, when Redis is unreachable', () => {
  it('closes instead of waiting for a reconnection that is not coming', async () => {
    const adapter = createAdapterConnections(UNREACHABLE);
    // What `createAdapter` does to the subscriber the moment the module is built. It is the
    // reason this ever hung: `quit()` is a command, so it queues behind this one, and the client
    // retries forever rather than failing the queue — the wait has no end to reach.
    adapter.sub.psubscribe('komtru_test:sock:*').catch(() => {});

    const startedAt = Date.now();
    await adapter.close();

    // Generous next to the budget the close path allows itself; the point is that it is bounded
    // at all. Before the deadline existed this call never returned.
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  }, 20_000);

  it('leaves neither client retrying, so a closed pair stops costing the process anything', async () => {
    const adapter = createAdapterConnections(UNREACHABLE);
    adapter.sub.psubscribe('komtru_test:sock:*').catch(() => {});
    await adapter.close();

    // ioredis reports a manually disconnected client as `reconnecting` for good, so the state to
    // assert on is the behaviour rather than the label: a client that gave up schedules no
    // further attempt.
    const retries: string[] = [];
    for (const [name, client] of [
      ['pub', adapter.pub],
      ['sub', adapter.sub],
    ] as const) {
      client.on('reconnecting', () => retries.push(name));
    }
    await new Promise((resolve) => setTimeout(resolve, WATCH_MS));

    expect(retries).toEqual([]);
  }, 20_000);
});
