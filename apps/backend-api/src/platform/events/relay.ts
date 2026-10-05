// The relay: the worker-only loop that moves outbox rows to subscriber queues (design §4.3).
//
// One transaction per tick claims a batch with FOR UPDATE SKIP LOCKED, enqueues the envelope for
// every subscriber of that event type, and marks the batch published before committing. Delivery is
// therefore at least once: a crash between the enqueue and the commit replays the rows, and the
// subscriber's processed_events marker makes the replay a no-op.
//
// ORDER. The ticket's promise is that rows reach subscriber queues in order per aggregate. Two
// things would break that and are handled here:
//   * `seq` is handed out at INSERT, not at COMMIT, so a slow transaction can commit a *lower* seq
//     after a faster one. A row is therefore only claimed once its inserting transaction is older
//     than every transaction still running (`created_xid < pg_snapshot_xmin(pg_current_snapshot())`),
//     after which no older row can still appear. That horizon is cluster-wide, so one long
//     transaction anywhere on the instance (a dump, an analytics query) would otherwise stall every
//     event: past `watermarkTimeoutMs` a row goes out regardless, counted and logged, because a
//     bounded risk of reordering beats an unbounded stall on a money platform.
//   * two workers relaying at once could enqueue overlapping batches out of order, so a tick takes
//     an advisory lock and does nothing if another worker already holds it.
// What this does NOT promise is ordered *execution*: a handler that fails is retried after a
// backoff and BullMQ runs the next job meanwhile. Handlers must be commutative or carry their own
// guard (deferred note on T-024).
import { eventEnvelopeSchema, type EventEnvelope } from '@komtru/shared-types';
import { inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { outbox } from '../../db/platform-schema.js';
import type { Logger } from '../logger.js';
import type { QueueFactory } from '../queue/factory.js';
import type { EventBus } from './bus.js';
import { queueFor } from './bus.js';
import { outboxMetrics } from './metrics.js';

export const OUTBOX_POLL_MS = 500;
export const OUTBOX_BATCH_SIZE = 100;
/** Published rows are kept this long for support questions and replays, then pruned. */
export const OUTBOX_RETENTION_DAYS = 14;
/**
 * Markers must outlive every artefact that can cause a redelivery. The longest-lived one is a
 * failed BullMQ job, kept 30 days (`removeOnFail` in queue/factory.ts): an operator retrying one on
 * day 29 must still find its marker, or the handler runs twice.
 */
export const PROCESSED_RETENTION_DAYS = 90;
/** Pruning runs once every this many ticks: housekeeping should not compete with delivery. */
const PRUNE_EVERY_TICKS = 60;
/** The backlog gauge is refreshed this often; it costs one indexed count. */
const MEASURE_EVERY_TICKS = 20;
const PRUNE_BATCH_SIZE = 10_000;
/** How long the enqueue phase may hold the claiming transaction open before the tick is abandoned. */
export const ENQUEUE_TIMEOUT_MS = 5_000;
/** How long a row may wait for the commit watermark before it is published anyway. */
export const WATERMARK_TIMEOUT_MS = 5_000;
/** A failing tick backs off exponentially from `pollMs` to here, instead of hammering. */
const MAX_BACKOFF_MS = 30_000;
/**
 * The advisory lock that keeps one relay live across the fleet. Held for the tick's transaction
 * only, so a crashed worker releases it with its connection.
 */
export const OUTBOX_RELAY_LOCK_KEY = 2_024_024;

interface OutboxRow {
  /** Raw rows carry whatever the driver returns; the fields below are the ones the relay reads. */
  [column: string]: unknown;
  seq: string;
  event_id: string;
  event_type: string;
  version: number;
  occurred_at: string | Date;
  within_watermark?: boolean;
  correlation_id: string | null;
  causation_id: string | null;
  actor: unknown;
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
  pruneBatchSize?: number;
  enqueueTimeoutMs?: number;
  /** 0 publishes without waiting for the watermark; tests that need determinism use it. */
  watermarkTimeoutMs?: number;
}

export interface RunningRelay {
  /** One pass. Returns how many rows were published. */
  tick(): Promise<number>;
  /** Refreshes the backlog gauge. */
  measureBacklog(): Promise<void>;
  /** Deletes what is past its retention window, in batches. Returns the row counts. */
  prune(): Promise<{ outbox: number; processedEvents: number }>;
  /** Lets the tick in flight finish, then stops polling. */
  stop(): Promise<void>;
}

const toEnvelope = (row: OutboxRow): EventEnvelope =>
  // Validated rather than trusted: a hand-written or legacy row fails here, where the relay can
  // quarantine it, instead of five retries deep inside a subscriber.
  eventEnvelopeSchema.parse({
    eventId: row.event_id,
    eventType: row.event_type,
    version: row.version,
    occurredAt: new Date(row.occurred_at).toISOString(),
    correlationId: row.correlation_id ?? undefined,
    causationId: row.causation_id ?? undefined,
    actor: row.actor,
    payload: row.payload,
  });

const withDeadline = async <T>(work: Promise<T>, ms: number, what: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export function startOutboxRelay({
  db,
  bus,
  queues,
  logger,
  pollMs = OUTBOX_POLL_MS,
  batchSize = OUTBOX_BATCH_SIZE,
  outboxRetentionDays = OUTBOX_RETENTION_DAYS,
  processedRetentionDays = PROCESSED_RETENTION_DAYS,
  pruneBatchSize = PRUNE_BATCH_SIZE,
  enqueueTimeoutMs = ENQUEUE_TIMEOUT_MS,
  watermarkTimeoutMs = WATERMARK_TIMEOUT_MS,
}: RelayOptions): RunningRelay {
  let stopped = false;
  let inFlight: Promise<unknown> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;
  let ticks = 0;
  let consecutiveFailures = 0;

  const tick = (): Promise<number> =>
    db.transaction(async (tx) => {
      const locked = await tx.execute<{ locked: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(${OUTBOX_RELAY_LOCK_KEY}) AS locked`,
      );
      // Another worker is relaying. Not a failure: it is the fleet working as intended.
      if (!locked.rows[0]?.locked) return 0;

      const claimed = await tx.execute<OutboxRow>(sql`
        SELECT seq, event_id, event_type, version, occurred_at, correlation_id, causation_id,
               actor, payload,
               created_xid < pg_snapshot_xmin(pg_current_snapshot()) AS within_watermark
          FROM platform.outbox
         WHERE published_at IS NULL
           AND (created_xid < pg_snapshot_xmin(pg_current_snapshot())
                OR created_at < now() - make_interval(secs => ${watermarkTimeoutMs} / 1000.0))
         ORDER BY seq
         LIMIT ${batchSize}
           FOR UPDATE SKIP LOCKED`);
      const overdue = claimed.rows.filter((row) => row.within_watermark === false).length;
      if (overdue) {
        outboxMetrics.recordWatermarkTimeout(overdue);
        logger.warn(
          { rows: overdue, watermarkTimeoutMs },
          'events: publishing past the commit watermark; a long-running transaction is holding it back',
        );
      }

      const jobsByQueue = new Map<string, { name: string; data: EventEnvelope; opts: { jobId: string } }[]>();
      const published: number[] = [];
      for (const row of claimed.rows) {
        let envelope: EventEnvelope;
        try {
          envelope = toEnvelope(row);
        } catch (error) {
          // It can never be delivered, and leaving it would stall every event behind it. Mark it
          // published, count it, and keep the row for the retention window so it can be inspected.
          logger.error(
            { err: error, eventId: row.event_id, eventType: row.event_type },
            'events: unprocessable outbox row',
          );
          outboxMetrics.recordUnprocessable();
          published.push(Number(row.seq));
          continue;
        }
        for (const subscriber of bus.subscribers(row.event_type)) {
          const queue = queueFor(subscriber);
          const jobs = jobsByQueue.get(queue) ?? [];
          jobs.push({
            name: row.event_type,
            data: envelope,
            // One job per event and subscriber: a replayed tick is deduplicated by BullMQ while the
            // job is still known, and by processed_events after that. No colon: BullMQ uses it as
            // its own key separator and rejects a custom id containing one.
            opts: { jobId: `${row.event_id}--${subscriber}` },
          });
          jobsByQueue.set(queue, jobs);
        }
        published.push(Number(row.seq));
      }

      if (jobsByQueue.size) {
        // One round trip per subscriber queue, under a deadline: the claiming transaction (and its
        // row locks, and its PgBouncer server connection) must not be parked on a stalled Redis.
        // A failure here rolls the whole tick back, so nothing is marked published.
        await withDeadline(
          (async () => {
            for (const [queue, jobs] of jobsByQueue) await queues.producer(queue).addBulk(jobs);
          })(),
          enqueueTimeoutMs,
          'events: relay enqueue',
        );
      }

      if (published.length) {
        await tx.update(outbox).set({ publishedAt: new Date() }).where(inArray(outbox.seq, published));
      }
      return published.length;
    });

  const measureBacklog = async (): Promise<void> => {
    const { rows } = await db.execute<{ depth: number; oldest_age_ms: string | null }>(sql`
      SELECT count(*)::int AS depth,
             EXTRACT(EPOCH FROM (now() - min(created_at))) * 1000 AS oldest_age_ms
        FROM platform.outbox
       WHERE published_at IS NULL`);
    const row = rows[0];
    const oldest = row?.oldest_age_ms;
    outboxMetrics.setBacklog(
      row?.depth ?? 0,
      oldest === null || oldest === undefined ? null : Number(oldest),
    );
  };

  /** Deletes in bounded batches, so one sweep never takes thousands of row locks at once. */
  const deleteInBatches = async (table: 'outbox' | 'processed_events', cutoff: string): Promise<number> => {
    const qualified = sql.raw(`platform.${table}`);
    const column = sql.raw(table === 'outbox' ? 'published_at' : 'processed_at');
    let removed = 0;
    for (;;) {
      const { rowCount } = await db.execute(sql`
        DELETE FROM ${qualified}
         WHERE ctid IN (
           SELECT ctid FROM ${qualified}
            WHERE ${column} IS NOT NULL AND ${column} < now() - ${cutoff}::interval
            LIMIT ${pruneBatchSize})`);
      const deleted = rowCount ?? 0;
      removed += deleted;
      if (deleted < pruneBatchSize) return removed;
    }
  };

  const prune = async (): Promise<{ outbox: number; processedEvents: number }> => ({
    outbox: await deleteInBatches('outbox', `${outboxRetentionDays} days`),
    processedEvents: await deleteInBatches('processed_events', `${processedRetentionDays} days`),
  });

  const loop = async () => {
    if (stopped) return;
    let delayMs = pollMs;
    try {
      const published = await tick();
      consecutiveFailures = 0;
      ticks += 1;
      if (ticks % MEASURE_EVERY_TICKS === 0) await measureBacklog();
      if (ticks % PRUNE_EVERY_TICKS === 0) {
        const removed = await prune();
        if (removed.outbox || removed.processedEvents) logger.info(removed, 'events: pruned');
      }
      // A full batch means there is more waiting: come straight back rather than idling.
      if (published >= batchSize) delayMs = 0;
    } catch (error) {
      consecutiveFailures += 1;
      outboxMetrics.recordTickFailure();
      // A deterministic failure (Redis out of memory, a paused queue) would otherwise log twice a
      // second forever. Back off, and let the backlog gauge raise the alarm instead.
      delayMs = Math.min(Math.max(pollMs, 1) * 2 ** Math.min(consecutiveFailures, 10), MAX_BACKOFF_MS);
      logger.error({ err: error, consecutiveFailures, delayMs }, 'events: relay tick failed');
    }
    schedule(delayMs);
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
    measureBacklog,
    prune,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight.catch(() => {});
    },
  };
}
