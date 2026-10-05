// The relay: the worker-only loop that moves outbox rows to subscriber queues (design §4.3).
//
// One transaction per tick claims a batch with FOR UPDATE SKIP LOCKED, enqueues a copy of the
// envelope for every subscriber of that event type, and marks the batch published before committing.
// Delivery is therefore at least once: a crash between the enqueue and the commit replays the row,
// and the subscriber's processed_events marker makes the replay a no-op.
//
// Order: rows are claimed and enqueued by `seq`, and the batch stops at the first row that fails to
// enqueue, so a later event for an aggregate never overtakes an earlier one.
import type { EventEnvelope } from '@komtru/shared-types';
import { inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { outbox } from '../../db/platform-schema.js';
import type { Logger } from '../logger.js';
import type { QueueFactory } from '../queue/factory.js';
import type { EventBus } from './bus.js';
import { queueFor } from './bus.js';

export const OUTBOX_POLL_MS = 500;
export const OUTBOX_BATCH_SIZE = 100;
/** Published rows are kept this long for support questions and replays, then pruned. */
export const OUTBOX_RETENTION_DAYS = 14;
/** Markers outlive the outbox rows they guard, so a late redelivery is still recognised. */
export const PROCESSED_RETENTION_DAYS = 30;
/** Pruning runs once every this many ticks: housekeeping should not compete with delivery. */
const PRUNE_EVERY_TICKS = 60;

interface OutboxRow {
  /** Raw rows carry whatever the driver returns; the fields below are the ones the relay reads. */
  [column: string]: unknown;
  seq: string;
  event_id: string;
  event_type: string;
  version: number;
  /** Raw SQL comes back unparsed on some drivers; normalise rather than trust the type. */
  occurred_at: string | Date;
  correlation_id: string | null;
  causation_id: string | null;
  actor: EventEnvelope['actor'];
  payload: unknown;
}

export interface RelayOptions {
  db: Db;
  bus: EventBus;
  queues: QueueFactory;
  logger: Logger;
  /** 0 disables the timer; tests drive `tick()` themselves. */
  pollMs?: number;
  batchSize?: number;
  outboxRetentionDays?: number;
  processedRetentionDays?: number;
}

export interface RunningRelay {
  /** One pass. Returns how many rows were published. */
  tick(): Promise<number>;
  /** Deletes what is past its retention window. Returns the row counts. */
  prune(): Promise<{ outbox: number; processedEvents: number }>;
  /** Lets the tick in flight finish, then stops polling. */
  stop(): Promise<void>;
}

const toEnvelope = (row: OutboxRow): EventEnvelope => ({
  eventId: row.event_id,
  eventType: row.event_type,
  version: row.version,
  occurredAt: new Date(row.occurred_at).toISOString(),
  correlationId: row.correlation_id ?? undefined,
  causationId: row.causation_id ?? undefined,
  actor: row.actor,
  payload: row.payload,
});

export function startOutboxRelay({
  db,
  bus,
  queues,
  logger,
  pollMs = OUTBOX_POLL_MS,
  batchSize = OUTBOX_BATCH_SIZE,
  outboxRetentionDays = OUTBOX_RETENTION_DAYS,
  processedRetentionDays = PROCESSED_RETENTION_DAYS,
}: RelayOptions): RunningRelay {
  let stopped = false;
  let inFlight: Promise<unknown> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;
  let ticks = 0;

  const tick = (): Promise<number> =>
    db.transaction(async (tx) => {
      const claimed = await tx.execute<OutboxRow>(sql`
        SELECT seq, event_id, event_type, version, occurred_at, correlation_id, causation_id, actor, payload
          FROM platform.outbox
         WHERE published_at IS NULL
         ORDER BY seq
         LIMIT ${batchSize}
           FOR UPDATE SKIP LOCKED`);

      const published: number[] = [];
      for (const row of claimed.rows) {
        const envelope = toEnvelope(row);
        try {
          for (const subscriber of bus.subscribers(row.event_type)) {
            await queues.producer(queueFor(subscriber)).add(row.event_type, envelope, {
              // One job per event and subscriber: a replayed tick is deduplicated by BullMQ while
              // the job is still known, and by processed_events after that.
              jobId: `${row.event_id}:${subscriber}`,
            });
          }
        } catch (error) {
          // Redis is unreachable or the queue rejected the job: leave this row and everything after
          // it unpublished, so the next tick replays them in order.
          logger.error(
            { err: error, eventId: row.event_id, eventType: row.event_type },
            'events: relay could not enqueue',
          );
          break;
        }
        published.push(Number(row.seq));
      }

      if (published.length) {
        await tx.update(outbox).set({ publishedAt: new Date() }).where(inArray(outbox.seq, published));
      }
      return published.length;
    });

  const prune = async (): Promise<{ outbox: number; processedEvents: number }> => {
    const outbox = await db.execute(
      sql`DELETE FROM platform.outbox
           WHERE published_at IS NOT NULL
             AND published_at < now() - ${`${outboxRetentionDays} days`}::interval`,
    );
    const processed = await db.execute(
      sql`DELETE FROM platform.processed_events
           WHERE processed_at < now() - ${`${processedRetentionDays} days`}::interval`,
    );
    return { outbox: outbox.rowCount ?? 0, processedEvents: processed.rowCount ?? 0 };
  };

  const loop = async () => {
    if (stopped) return;
    try {
      const published = await tick();
      ticks += 1;
      if (ticks % PRUNE_EVERY_TICKS === 0) {
        const removed = await prune();
        if (removed.outbox || removed.processedEvents) logger.info(removed, 'events: pruned');
      }
      // A full batch means there is more waiting: come straight back rather than idling.
      if (published >= batchSize) return schedule(0);
    } catch (error) {
      logger.error({ err: error }, 'events: relay tick failed');
    }
    schedule(pollMs);
  };

  const schedule = (delayMs: number) => {
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = loop();
    }, delayMs);
    timer.unref();
  };

  if (pollMs > 0) schedule(0);

  return {
    tick,
    prune,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight.catch(() => {});
    },
  };
}
