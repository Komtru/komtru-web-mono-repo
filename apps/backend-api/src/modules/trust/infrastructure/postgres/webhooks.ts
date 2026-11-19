// The delivery log's SQL. Every status move is a guarded UPDATE that reports whether it applied.
//
// That shape is not defensive style, it is the defect T-050's review found three separate times:
// state read at the top of a function and written at the bottom without re-checking, so a job
// finishing after a sweep had already closed its request overwrote the closure. Here the same race
// is two workers holding one redelivered webhook. The loser must do nothing, and the only way it
// can know it lost is for the UPDATE to tell it.
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../../../../db/index.js';
import type { KycProvider } from './schema/enums.js';
import { providerWebhooks, type WebhookStatus } from './schema/provider-webhooks.js';
import { verificationRequests } from './schema/requests.js';

/** How much of an unsigned body is kept. Enough to recognise it; not enough to be a place to write. */
export const UNSIGNED_PAYLOAD_LIMIT = 4096;

export interface RecordDeliveryInput {
  provider: KycProvider;
  providerEventId: string;
  eventType: string;
  payload: unknown;
  rawBodySha256: string;
  signatureValid: boolean;
}

export type RecordDeliveryResult =
  | { outcome: 'stored'; id: bigint }
  | { outcome: 'duplicate'; id: bigint }
  | { outcome: 'unsigned'; id: bigint };

/**
 * Insert, or count the replay.
 *
 * An unsigned delivery is stored at `SKIPPED` and never queued — see the schema header for why it is
 * stored at all. A replay is absorbed by the dedup index and increments a counter instead of
 * creating a second row, so a provider retrying a delivery we already handled costs one UPDATE.
 */
export async function recordDelivery(db: Db, input: RecordDeliveryInput): Promise<RecordDeliveryResult> {
  const status: WebhookStatus = input.signatureValid ? 'RECEIVED' : 'SKIPPED';
  const rows = await db
    .insert(providerWebhooks)
    .values({
      provider: input.provider,
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      payload: input.payload,
      rawBodySha256: input.rawBodySha256,
      signatureValid: input.signatureValid,
      status,
      ...(input.signatureValid ? {} : { processingError: 'signature check failed', finishedAt: sql`now()` }),
    })
    .onConflictDoNothing({
      target: [providerWebhooks.provider, providerWebhooks.providerEventId],
    })
    .returning({ id: providerWebhooks.id });

  const inserted = rows[0];
  if (inserted) {
    return { outcome: input.signatureValid ? 'stored' : 'unsigned', id: inserted.id };
  }

  const bumped = await db
    .update(providerWebhooks)
    .set({ duplicateCount: sql`${providerWebhooks.duplicateCount} + 1` })
    .where(
      and(
        eq(providerWebhooks.provider, input.provider),
        eq(providerWebhooks.providerEventId, input.providerEventId),
      ),
    )
    .returning({ id: providerWebhooks.id });

  // The row exists by definition — the conflict is what brought us here.
  return { outcome: 'duplicate', id: bumped[0]?.id ?? 0n };
}

/**
 * `RECEIVED | FAILED -> PROCESSING`, and whether this caller is the one that got it.
 *
 * `FAILED` is included so the stale sweep and a BullMQ retry can pick a delivery back up; `PROCESSED`
 * and `SKIPPED` are terminal and deliberately absent.
 */
export async function claimDelivery(db: Db, id: bigint): Promise<boolean> {
  const rows = await db
    .update(providerWebhooks)
    .set({
      status: 'PROCESSING',
      processingStartedAt: sql`now()`,
      attempts: sql`${providerWebhooks.attempts} + 1`,
      processingError: null,
    })
    .where(and(eq(providerWebhooks.id, id), inArray(providerWebhooks.status, ['RECEIVED', 'FAILED'])))
    .returning({ id: providerWebhooks.id });
  return rows.length > 0;
}

/** `PROCESSING -> PROCESSED | FAILED | SKIPPED`. False means somebody else already finished it. */
export async function finishDelivery(
  db: Db,
  id: bigint,
  status: Extract<WebhookStatus, 'PROCESSED' | 'FAILED' | 'SKIPPED'>,
  processingError?: string,
): Promise<boolean> {
  const rows = await db
    .update(providerWebhooks)
    .set({
      status,
      finishedAt: sql`now()`,
      ...(processingError === undefined ? {} : { processingError }),
    })
    .where(and(eq(providerWebhooks.id, id), eq(providerWebhooks.status, 'PROCESSING')))
    .returning({ id: providerWebhooks.id });
  return rows.length > 0;
}

export async function findDelivery(db: Db, id: bigint) {
  const rows = await db.select().from(providerWebhooks).where(eq(providerWebhooks.id, id)).limit(1);
  return rows[0];
}

/**
 * Deliveries a worker took and never finished.
 *
 * A row in `PROCESSING` past this age means the process holding it died: nothing else can move it,
 * because `claimDelivery` refuses a `PROCESSING` row and `finishDelivery` is only ever called by the
 * holder. Returning them to `FAILED` makes them claimable again, and `attempts` bounds how often
 * that can happen so a delivery that kills its worker every time becomes visible instead of looping.
 */
export async function reapStaleDeliveries(
  db: Db,
  olderThanSeconds: number,
  maxAttempts: number,
): Promise<bigint[]> {
  const rows = await db
    .update(providerWebhooks)
    .set({ status: 'FAILED', processingError: 'processing did not finish; worker presumed lost' })
    .where(
      and(
        eq(providerWebhooks.status, 'PROCESSING'),
        lt(providerWebhooks.processingStartedAt, sql`now() - make_interval(secs => ${olderThanSeconds})`),
        lt(providerWebhooks.attempts, maxAttempts),
      ),
    )
    .returning({ id: providerWebhooks.id });
  return rows.map((row) => row.id);
}

/** The request a delivery names, found by the reference that travelled through the browser. */
export async function findRequestBySessionRef(db: Db, sessionRef: string) {
  const rows = await db
    .select()
    .from(verificationRequests)
    .where(eq(verificationRequests.providerSessionRef, sessionRef))
    .limit(1);
  return rows[0];
}

/**
 * Deletes deliveries that are finished and old.
 *
 * The route is public, so this table is the one place an unauthenticated caller can put bytes in
 * our database. Truncation bounds a single row; only this bounds how many rows there are.
 */
export async function pruneDeliveries(db: Db, olderThanDays: number): Promise<number> {
  const rows = await db
    .delete(providerWebhooks)
    .where(
      and(
        inArray(providerWebhooks.status, ['PROCESSED', 'SKIPPED']),
        lt(providerWebhooks.finishedAt, sql`now() - make_interval(days => ${olderThanDays})`),
      ),
    )
    .returning({ id: providerWebhooks.id });
  return rows.length;
}
