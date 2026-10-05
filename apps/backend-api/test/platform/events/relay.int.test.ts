// The outbox relay against a real database, with the queue factory stubbed. Skipped unless KOMTRU_INFRA_TESTS=1.
import { defineEvent, type EventEnvelope } from '@komtru/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { loadConfig } from '../../../src/config/env.js';
import { createEventBus } from '../../../src/platform/events/bus.js';
import { publish } from '../../../src/platform/events/publish.js';
import { startOutboxRelay, type RunningRelay } from '../../../src/platform/events/relay.js';
import { createLogger } from '../../../src/platform/logger.js';
import type { QueueDefinition, QueueFactory } from '../../../src/platform/queue/factory.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';

const logger = createLogger(
  loadConfig({
    LOG_LEVEL: 'silent',
    POSTGRES_URL: 'postgresql://x@localhost/x',
    REDIS_URL: 'redis://localhost:56379',
  }),
);

const tradeCompleted = defineEvent(
  'trades.trade.completed',
  1,
  z.object({ tradeId: z.uuid(), step: z.number() }),
);
const unwatched = defineEvent('growth.referral.awarded', 1, z.object({ userId: z.uuid() }));

const TRADE_ID = '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b';

interface Enqueued {
  queue: string;
  envelope: EventEnvelope<{ tradeId: string; step: number }>;
  options: { jobId?: string };
}

/** Records every enqueue; `failOnce` makes the next one throw, as a Redis outage would. */
const stubQueues = () => {
  const enqueued: Enqueued[] = [];
  let failures = 0;
  const factory = {
    define: () => {},
    consume: (definition: QueueDefinition<unknown>) => definition as never,
    producer: (queue: string) => ({
      add: (_name: string, envelope: Enqueued['envelope'], options: Enqueued['options']) => {
        if (failures > 0) {
          failures -= 1;
          return Promise.reject(new Error('redis unavailable'));
        }
        enqueued.push({ queue, envelope, options });
        return Promise.resolve({});
      },
    }),
    run: () => {},
    close: async () => {},
  } as unknown as QueueFactory;
  return { factory, enqueued, failNext: (times = 1) => (failures = times) };
};

describe.runIf(infraEnabled)('outbox relay', () => {
  const t = useTestDatabase();
  let relay: RunningRelay | undefined;
  afterEach(async () => {
    await relay?.stop();
    relay = undefined;
  });

  const busWith = (queues: QueueFactory, subscribers: string[]) => {
    const bus = createEventBus({ db: t.db(), queues, logger, role: 'worker' });
    for (const name of subscribers) {
      bus.subscribe({ name, event: tradeCompleted, handler: async () => {} });
    }
    return bus;
  };

  const emit = (step: number, aggregateId = TRADE_ID) =>
    t
      .db()
      .transaction((tx) =>
        publish(tx, tradeCompleted, {
          payload: { tradeId: TRADE_ID, step },
          aggregateType: 'trade',
          aggregateId,
        }),
      );

  const unpublished = async () => {
    const { rows } = await t.app().query('SELECT seq FROM platform.outbox WHERE published_at IS NULL');
    return rows.length;
  };

  it('moves a row to every subscribed queue and marks it published', async () => {
    const queues = stubQueues();
    const bus = busWith(queues.factory, ['ledger.on-trade-completed', 'notify.on-trade-completed']);
    const envelope = await emit(1);
    relay = startOutboxRelay({ db: t.db(), bus, queues: queues.factory, logger, pollMs: 0 });

    expect(await relay.tick()).toBe(1);

    expect(queues.enqueued.map((e) => e.queue)).toEqual([
      'events.ledger.on-trade-completed',
      'events.notify.on-trade-completed',
    ]);
    expect(queues.enqueued[0]?.envelope).toMatchObject({
      eventId: envelope.eventId,
      eventType: 'trades.trade.completed',
      version: 1,
      occurredAt: envelope.occurredAt,
      actor: { type: 'SYSTEM' },
      payload: { tradeId: TRADE_ID, step: 1 },
    });
    // One job id per event and subscriber, so a replayed tick does not double-queue.
    expect(queues.enqueued[0]?.options.jobId).toBe(`${envelope.eventId}:ledger.on-trade-completed`);
    expect(await unpublished()).toBe(0);
  });

  it('marks an event with no subscribers published without enqueueing it', async () => {
    const queues = stubQueues();
    const bus = busWith(queues.factory, ['ledger.on-trade-completed']);
    await t.db().transaction((tx) => publish(tx, unwatched, { payload: { userId: TRADE_ID } }));
    relay = startOutboxRelay({ db: t.db(), bus, queues: queues.factory, logger, pollMs: 0 });

    expect(await relay.tick()).toBe(1);
    expect(queues.enqueued).toHaveLength(0);
    expect(await unpublished()).toBe(0);
  });

  it("delivers one aggregate's events in sequence order", async () => {
    const queues = stubQueues();
    const bus = busWith(queues.factory, ['ledger.on-trade-completed']);
    for (const step of [1, 2, 3]) await emit(step);
    relay = startOutboxRelay({ db: t.db(), bus, queues: queues.factory, logger, pollMs: 0 });

    expect(await relay.tick()).toBe(3);
    expect(queues.enqueued.map((e) => e.envelope.payload.step)).toEqual([1, 2, 3]);
  });

  it('leaves the row unpublished when the enqueue fails, and stops the batch there', async () => {
    const queues = stubQueues();
    const bus = busWith(queues.factory, ['ledger.on-trade-completed']);
    for (const step of [1, 2]) await emit(step);
    relay = startOutboxRelay({ db: t.db(), bus, queues: queues.factory, logger, pollMs: 0 });
    queues.failNext();

    expect(await relay.tick()).toBe(0);
    expect(queues.enqueued).toHaveLength(0);
    expect(await unpublished()).toBe(2);

    // The next tick picks both up again, still in order.
    expect(await relay.tick()).toBe(2);
    expect(queues.enqueued.map((e) => e.envelope.payload.step)).toEqual([1, 2]);
  });

  it('skips rows another relay has locked', async () => {
    const queues = stubQueues();
    const bus = busWith(queues.factory, ['ledger.on-trade-completed']);
    await emit(1);
    await emit(2);
    relay = startOutboxRelay({ db: t.db(), bus, queues: queues.factory, logger, pollMs: 0 });

    const locker = await t.app().connect();
    try {
      await locker.query('BEGIN');
      await locker.query('SELECT seq FROM platform.outbox ORDER BY seq LIMIT 1 FOR UPDATE');
      expect(await relay.tick()).toBe(1);
      expect(queues.enqueued.map((e) => e.envelope.payload.step)).toEqual([2]);
    } finally {
      await locker.query('ROLLBACK');
      locker.release();
    }
    expect(await unpublished()).toBe(1);
  });

  it('prunes published rows past the retention window and keeps unpublished ones', async () => {
    const queues = stubQueues();
    const bus = busWith(queues.factory, []);
    await emit(1);
    await emit(2);
    relay = startOutboxRelay({
      db: t.db(),
      bus,
      queues: queues.factory,
      logger,
      pollMs: 0,
      outboxRetentionDays: 14,
      processedRetentionDays: 30,
    });
    await relay.tick();
    // Age one published row past the window, and leave an unpublished one behind.
    await t
      .app()
      .query(
        `UPDATE platform.outbox SET published_at = now() - interval '20 days' WHERE seq = (SELECT min(seq) FROM platform.outbox)`,
      );
    await emit(3);
    await t.app().query(
      `INSERT INTO platform.processed_events (event_id, subscriber, processed_at)
         VALUES ($1, 'ledger.on-trade-completed', now() - interval '40 days')`,
      [TRADE_ID],
    );

    const pruned = await relay.prune();

    expect(pruned).toEqual({ outbox: 1, processedEvents: 1 });
    const { rows } = await t.app().query<{ n: number }>('SELECT count(*)::int AS n FROM platform.outbox');
    expect(rows[0]?.n).toBe(2);
    const { rows: markers } = await t
      .app()
      .query<{ n: number }>('SELECT count(*)::int AS n FROM platform.processed_events');
    expect(markers[0]?.n).toBe(0);
  });

  it('polls on its own until stopped', async () => {
    const queues = stubQueues();
    const bus = busWith(queues.factory, ['ledger.on-trade-completed']);
    relay = startOutboxRelay({ db: t.db(), bus, queues: queues.factory, logger, pollMs: 10 });
    await emit(1);

    await vi.waitFor(() => expect(queues.enqueued).toHaveLength(1), { timeout: 5000 });
    await relay.stop();
    const after = queues.enqueued.length;
    await emit(2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(queues.enqueued).toHaveLength(after);
  });
});
