// The request side of a Youverify webhook: verify, store, queue, 200. Nothing else.
//
// The ordering is the whole design. The signature is checked on the raw bytes before anything is
// stored; the row is written before the job is queued, so a Redis failure between the two leaves a
// delivery we can still see and reap rather than one that evaporated; and the provider gets its 200
// without waiting on a database read of the request, a level grant, or a socket push. Youverify
// retries on any non-2xx, so a slow handler turns one delivery into several.
import { createHash } from 'node:crypto';
import type { Db } from '../../../db/index.js';
import type { Logger } from '../../../platform/logger.js';
import {
  recordDelivery,
  UNSIGNED_PAYLOAD_LIMIT,
  type RecordDeliveryResult,
} from '../infrastructure/postgres/webhooks.js';
import { verifyYouverifySignature } from '../infrastructure/providers/youverify.signature.js';

export interface RecordWebhookDeps {
  db: Db;
  webhookSecret: string;
  /** Queues the processing job for one stored delivery. */
  enqueueDelivery: (webhookId: bigint) => Promise<void>;
  logger: Logger;
}

/**
 * Youverify's envelope. Only three fields are read, and all three are treated as untrusted: this is
 * a public route, and a body that failed its signature check still reaches the parser.
 */
interface Envelope {
  event?: unknown;
  data?: { id?: unknown; metadata?: { reference?: unknown } };
}

/**
 * The dedup key.
 *
 * Youverify's documentation names `eventId` for its KYT events and suggests `data.id` or
 * `data.verificationId` otherwise, and the envelope example shows none of them — so the key is read
 * defensively and falls back to the body digest. A digest is a correct dedup key for an exact
 * replay, which is what a retry is; it only fails to collapse two deliveries that differ in a byte,
 * and those are two events by any reading.
 */
function eventId(envelope: Envelope, rawSha: string): string {
  const id = envelope.data?.id;
  return typeof id === 'string' && id.length > 0 ? id : `sha256:${rawSha}`;
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** The reference the SDK echoed back. Read here only to log; the job re-reads it from the payload. */
export function referenceOf(payload: unknown): string | undefined {
  const envelope = payload as Envelope;
  return asString(envelope.data?.metadata?.reference);
}

export type RecordWebhookOutcome = RecordDeliveryResult['outcome'] | 'unreadable';

export async function recordWebhook(
  deps: RecordWebhookDeps,
  raw: Buffer,
  signature: string | undefined,
): Promise<RecordWebhookOutcome> {
  const rawBodySha256 = createHash('sha256').update(raw).digest('hex');
  const signatureValid = verifyYouverifySignature(raw, signature, deps.webhookSecret);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    // Unparseable and therefore undeduplicable and unprocessable. Logged by digest so a flood of
    // them is still countable, and not stored: there is no event here to be idempotent about.
    deps.logger.warn({ rawBodySha256, signatureValid }, 'trust: unreadable youverify delivery');
    return 'unreadable';
  }

  const envelope = (parsed ?? {}) as Envelope;
  // An unsigned body is truncated before it is stored: this route is public, so its payload column
  // is the one place an unauthenticated caller can put bytes in our database.
  const payload = signatureValid
    ? parsed
    : { truncated: raw.toString('utf8').slice(0, UNSIGNED_PAYLOAD_LIMIT) };

  const result = await recordDelivery(deps.db, {
    provider: 'YOUVERIFY',
    providerEventId: eventId(envelope, rawBodySha256),
    eventType: asString(envelope.event) ?? 'unknown',
    payload,
    rawBodySha256,
    signatureValid,
  });

  if (result.outcome === 'stored') {
    await deps.enqueueDelivery(result.id);
  } else if (result.outcome === 'unsigned') {
    // Stored at SKIPPED and never queued. Warned rather than logged quietly, because the likeliest
    // cause is a rotated or mistyped webhook secret, and the symptom otherwise is verifications
    // that mysteriously never resolve.
    deps.logger.warn(
      { webhookId: String(result.id), rawBodySha256 },
      'trust: youverify delivery failed its signature check; stored but not queued',
    );
  }

  return result.outcome;
}
