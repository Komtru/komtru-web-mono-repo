// The event bus against a real database, with the queue factory stubbed so delivery is deterministic.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { defineEvent, type EventEnvelope } from '@komtru/shared-types';
import { UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { loadConfig } from '../../../src/config/env.js';
import { createEventBus } from '../../../src/platform/events/bus.js';
import { publish, type Tx } from '../../../src/platform/events/publish.js';
import { createLogger } from '../../../src/platform/logger.js';
import type { QueueDefinition, QueueFactory } from '../../../src/platform/queue/factory.js';
import { infraEnabled, testRedisEnv, testRedisUrl } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';

const logger = createLogger(
  loadConfig({
    LOG_LEVEL: 'silent',
    POSTGRES_URL: 'postgresql://x@localhost/x',
    REDIS_URL: testRedisUrl(),
    ...testRedisEnv(),
  }),
);

const tradeCompleted = defineEvent('trades.trade.completed', 1, z.object({ tradeId: z.uuid() }));
const tradeCancelled = defineEvent('trades.trade.cancelled', 1, z.object({ tradeId: z.uuid() }));

const TRADE_ID = '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b';

const envelope = (overrides: Partial<EventEnvelope> = {}): EventEnvelope => ({
  eventId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a01',
  eventType: tradeCompleted.eventType,
  version: 1,
  occurredAt: '2026-10-05T09:30:00.000Z',
  actor: { type: 'SYSTEM' },
  payload: { tradeId: TRADE_ID },
  ...overrides,
});

/** Captures what the bus registers, so a test can run a subscriber's processor directly. */
const stubQueues = () => {
  const defined = new Map<string, QueueDefinition<unknown>>();
  const consumed: string[] = [];
  const factory = {
    define: (definition: QueueDefinition<never>) => defined.set(definition.name, definition),
    consume: (definition: QueueDefinition<unknown>) => {
      consumed.push(definition.name);
      defined.set(definition.name, definition);
      return {} as never;
    },
    producer: () => ({ add: vi.fn() }) as never,
    run: () => {},
    close: async () => {},
  } as unknown as QueueFactory;
  const deliver = async (queue: string, data: unknown) => {
    const definition = defined.get(queue);
    if (!definition) throw new Error(`no subscriber queue '${queue}'`);
    return definition.process(data, {} as never);
  };
  return { factory, defined, consumed, deliver };
};

describe.runIf(infraEnabled)('event bus', () => {
  const t = useTestDatabase();
  const processed = () =>
    t.app().query<{ subscriber: string }>('SELECT subscriber FROM platform.processed_events');

  it('runs the handler once and records the event for that subscriber', async () => {
    const queues = stubQueues();
    const handler = vi.fn(async () => {});
    const bus = createEventBus({ db: t.db(), queues: queues.factory, logger, role: 'worker' });
    bus.subscribe({ name: 'ledger.on-trade-completed', event: tradeCompleted, handler });

    await queues.deliver('events.ledger.on-trade-completed', envelope());

    expect(handler).toHaveBeenCalledTimes(1);
    expect((await processed()).rows).toEqual([{ subscriber: 'ledger.on-trade-completed' }]);
  });

  // A subscriber that enqueues a job for its own rows cannot do it inside the handler: the worker
  // can pick the job up and read the row before the transaction that wrote it has committed. The
  // send job already anticipates that and throws "is not committed yet", which burns an attempt —
  // with two attempts and a 100ms backoff, both can land early and the notification dead-letters
  // even though nothing was wrong with it. So the bus takes the work and runs it after the commit.
  it('runs a handler\u2019s deferred work after the transaction has committed', async () => {
    const queues = stubQueues();
    const bus = createEventBus({ db: t.db(), queues: queues.factory, logger, role: 'worker' });
    let visibleFromAnotherConnection: number | undefined;

    bus.subscribe({
      name: 'ledger.on-trade-completed',
      event: tradeCompleted,
      handler: () =>
        Promise.resolve(async () => {
          // A separate pool connection: it can only see rows the handler's transaction committed.
          const { rows } = await t
            .app()
            .query<{ n: string }>('SELECT count(*) AS n FROM platform.processed_events');
          visibleFromAnotherConnection = Number(rows[0]!.n);
        }),
    });

    await queues.deliver('events.ledger.on-trade-completed', envelope());

    expect(visibleFromAnotherConnection).toBe(1);
  });

  it('is a no-op when the same envelope is delivered again', async () => {
    const queues = stubQueues();
    const handler = vi.fn(async () => {});
    const bus = createEventBus({ db: t.db(), queues: queues.factory, logger, role: 'worker' });
    bus.subscribe({ name: 'ledger.on-trade-completed', event: tradeCompleted, handler });

    await queues.deliver('events.ledger.on-trade-completed', envelope());
    await queues.deliver('events.ledger.on-trade-completed', envelope());

    expect(handler).toHaveBeenCalledTimes(1);
    expect((await processed()).rows).toHaveLength(1);
  });

  it('lets a second subscriber handle the same event', async () => {
    const queues = stubQueues();
    const bus = createEventBus({ db: t.db(), queues: queues.factory, logger, role: 'worker' });
    const ledger = vi.fn(async () => {});
    const notify = vi.fn(async () => {});
    bus.subscribe({ name: 'ledger.on-trade-completed', event: tradeCompleted, handler: ledger });
    bus.subscribe({ name: 'notify.on-trade-completed', event: tradeCompleted, handler: notify });

    await queues.deliver('events.ledger.on-trade-completed', envelope());
    await queues.deliver('events.notify.on-trade-completed', envelope());

    expect(ledger).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect((await processed()).rows).toHaveLength(2);
  });

  it('rolls the marker back with the handler when the handler throws', async () => {
    const queues = stubQueues();
    const bus = createEventBus({ db: t.db(), queues: queues.factory, logger, role: 'worker' });
    bus.subscribe({
      name: 'ledger.on-trade-completed',
      event: tradeCompleted,
      // Writes, then fails: the write and the marker must disappear together.
      handler: async (_event: EventEnvelope<{ tradeId: string }>, tx: Tx) => {
        await publish(tx, tradeCancelled, { payload: { tradeId: TRADE_ID } });
        throw new Error('ledger unavailable');
      },
    });

    await expect(queues.deliver('events.ledger.on-trade-completed', envelope())).rejects.toThrow(
      'ledger unavailable',
    );

    expect((await processed()).rows).toHaveLength(0);
    const { rows } = await t.app().query('SELECT 1 FROM platform.outbox');
    expect(rows).toHaveLength(0);
  });

  it('gives the handler the parsed payload and rejects one that does not match', async () => {
    const queues = stubQueues();
    const bus = createEventBus({ db: t.db(), queues: queues.factory, logger, role: 'worker' });
    const handler = vi.fn(async () => {});
    bus.subscribe({ name: 'ledger.on-trade-completed', event: tradeCompleted, handler });

    await expect(
      queues.deliver('events.ledger.on-trade-completed', envelope({ payload: { tradeId: 'nope' } })),
    ).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('dead-letters an envelope whose version the subscriber does not handle', async () => {
    const queues = stubQueues();
    const bus = createEventBus({ db: t.db(), queues: queues.factory, logger, role: 'worker' });
    const handler = vi.fn(async () => {});
    bus.subscribe({
      name: 'ledger.on-trade-completed',
      event: defineEvent('trades.trade.completed', 2, z.object({ tradeId: z.uuid() })),
      handler,
    });

    // UnrecoverableError, not a retry: the mismatch is deterministic, so five attempts only delay
    // the dead-letter and the alert that goes with it.
    const delivery = queues.deliver('events.ledger.on-trade-completed', envelope({ version: 1 }));
    await expect(delivery).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(delivery).rejects.toThrow(/v1 reached 'ledger.on-trade-completed', which handles v2/);
    expect(handler).not.toHaveBeenCalled();
    expect((await processed()).rows).toHaveLength(0);
  });

  it('rejects a duplicate subscriber name', () => {
    const queues = stubQueues();
    const bus = createEventBus({ db: t.db(), queues: queues.factory, logger, role: 'worker' });
    const subscription = {
      name: 'ledger.on-trade-completed',
      event: tradeCompleted,
      handler: async () => {},
    };
    bus.subscribe(subscription);
    expect(() => bus.subscribe(subscription)).toThrow(/ledger.on-trade-completed/);
  });

  it('lists the subscribers of an event type for the relay', () => {
    const queues = stubQueues();
    const bus = createEventBus({ db: t.db(), queues: queues.factory, logger, role: 'worker' });
    bus.subscribe({ name: 'ledger.on-trade-completed', event: tradeCompleted, handler: async () => {} });
    bus.subscribe({ name: 'notify.on-trade-completed', event: tradeCompleted, handler: async () => {} });
    bus.subscribe({ name: 'notify.on-trade-cancelled', event: tradeCancelled, handler: async () => {} });

    expect(bus.subscribers(tradeCompleted.eventType)).toEqual([
      'ledger.on-trade-completed',
      'notify.on-trade-completed',
    ]);
    expect(bus.subscribers('park.parcel.released')).toEqual([]);
  });

  it('defines the queue but consumes nothing in the api process', () => {
    const queues = stubQueues();
    const bus = createEventBus({ db: t.db(), queues: queues.factory, logger, role: 'api' });
    bus.subscribe({ name: 'ledger.on-trade-completed', event: tradeCompleted, handler: async () => {} });

    expect(queues.consumed).toEqual([]);
    expect([...queues.defined.keys()]).toEqual(['events.ledger.on-trade-completed']);
  });
});
