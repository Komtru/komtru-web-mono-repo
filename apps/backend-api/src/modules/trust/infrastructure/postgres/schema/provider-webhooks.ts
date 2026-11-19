// Inbound provider webhooks, with a lifecycle rather than a boolean.
//
// `ledger.payment_provider_webhooks` records *received* and *processed* and nothing in between, so a
// worker that dies mid-job leaves a row indistinguishable from one that never started. This table
// adds the state the operator actually asks about — "did the processor finish?" — and the two
// timestamps that bracket it.
//
// Two deliberate departures from the ledger's table:
//
//  1. **No CHECK that the signature was valid.** The ledger refuses an unsigned delivery before any
//     row exists. Here an invalid one IS stored, at `SKIPPED`, because a rotated or mistyped webhook
//     key otherwise makes deliveries vanish with no symptom but verifications that never resolve —
//     the exact failure this lifecycle exists to surface. It is never enqueued.
//  2. **A truncated payload for unsigned rows.** This route is public and unauthenticated by
//     construction, so a stored body is a write surface. A valid delivery keeps its whole payload;
//     an invalid one keeps the first 4 KB plus `raw_body_sha256`, which is enough to recognise a
//     replay or a key rotation and not enough to be worth filling a disk with.
import { sql } from 'drizzle-orm';
import { bigserial, boolean, index, integer, jsonb, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { trust } from './columns.js';
import { kycProvider } from './enums.js';

/**
 * `SKIPPED` is terminal and distinct from `FAILED` on purpose: a delivery naming a reference that
 * does not exist, or one whose request is already decided, will never become processable, and
 * retrying it forever only hides it behind a growing attempt count.
 */
export const WEBHOOK_STATUSES = ['RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'SKIPPED'] as const;
export type WebhookStatus = (typeof WEBHOOK_STATUSES)[number];
export const webhookStatus = trust.enum('webhook_status', WEBHOOK_STATUSES);

export const providerWebhooks = trust.table(
  'provider_webhooks',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    provider: kycProvider('provider').notNull(),
    /** The provider's own id for this event, as the dedup key. */
    providerEventId: text('provider_event_id').notNull(),
    eventType: text('event_type').notNull(),
    /** The parsed body. Whole for a signed delivery, truncated for an unsigned one. */
    payload: jsonb('payload').notNull(),
    /** Digest of the bytes exactly as they arrived, so a replay is recognisable without the body. */
    rawBodySha256: text('raw_body_sha256').notNull(),
    /** Deliberately NOT constrained to true, unlike the ledger's table. See the header. */
    signatureValid: boolean('signature_valid').notNull(),
    status: webhookStatus('status').notNull().default('RECEIVED'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set on the guarded move into PROCESSING. Null here with a PROCESSING status means a crash. */
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Why processing stopped without acting: unknown reference, already decided, and so on. */
    processingError: text('processing_error'),
    /** Incremented on every move into PROCESSING, so a redelivery loop is visible rather than silent. */
    attempts: integer('attempts').notNull().default(0),
    /** Replays of this event absorbed by the dedup index. */
    duplicateCount: integer('duplicate_count').notNull().default(0),
  },
  (table) => [
    uniqueIndex('trust_provider_webhooks_dedup').on(table.provider, table.providerEventId),
    // The stale sweep's index: rows still in flight, oldest first.
    index('trust_provider_webhooks_inflight_idx')
      .on(table.receivedAt)
      .where(sql`${table.status} IN ('RECEIVED', 'PROCESSING')`),
  ],
);

export type ProviderWebhookRow = typeof providerWebhooks.$inferSelect;
