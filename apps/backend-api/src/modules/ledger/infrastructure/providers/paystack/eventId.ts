// The dedup key for one Paystack delivery (M8 D4, §5.4). Pure: the webhook route calls it inline.
//
// Paystack sends no event id, and retries a delivery for up to 72 hours. What identifies an event is
// its type plus the provider's own id for the object it is about (a transaction, a transfer, a
// refund), so a redelivery maps onto the same row whatever else in the body moved. A body with no
// id falls back to a hash of its exact bytes: a byte-identical redelivery still dedups, and the
// ledger's own idempotency key (`charge:<reference>`) is what stops a differently-worded one posting
// twice.
import { z } from 'zod';
import { sha256 } from '../../../../../platform/crypto/hmac.js';

const envelope = z.object({
  event: z.string().min(1).max(100),
  data: z.looseObject({}),
});

/** The provider's id for the object, when it is one we can key on; anything else falls back. */
const objectId = z.union([z.string().min(1).max(100), z.number().int().nonnegative()]);

/** `charge.success:302961`, or null for a body that is not a Paystack event envelope at all. */
export function paystackEventId(rawBody: Buffer): string | null {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return null;
  }
  const parsed = envelope.safeParse(payload);
  if (!parsed.success) return null;

  const { event, data } = parsed.data;
  const id = objectId.safeParse(data['id']);
  if (id.success) return `${event}:${String(id.data)}`;
  return `${event}:sha256:${sha256(rawBody).toString('hex')}`;
}
