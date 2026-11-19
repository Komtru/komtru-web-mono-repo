// Is this delivery really from Youverify? Pure, and the only thing standing between a public route
// and the verification level it can grant.
import { createHmac, timingSafeEqual } from 'node:crypto';

/** The header Youverify signs with. Its older API reference calls it `x-youverify-signature`. */
export const YOUVERIFY_SIGNATURE_HEADER = 'x-yv-signature';

/**
 * HMAC-SHA256 of the RAW body, hex, compared in constant time.
 *
 * Three things here are deliberate:
 *
 * - **The raw bytes.** `raw` must be what arrived, not a re-serialised parse of it — see the test
 *   named for it. The route reads them through `rawBody(req)`, which is why the path has to live
 *   under `WEBHOOK_PATH_PREFIX`.
 * - **The length check before `timingSafeEqual`.** That function throws on a length mismatch, and a
 *   throw out of an authentication check is a 500 where a `false` belongs.
 * - **`false`, never an exception.** A malformed header is a failed check, not an error condition:
 *   anyone on the internet can send one, and the handler's job is to refuse it quietly.
 */
export function verifyYouverifySignature(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  /*
    An empty or blank secret is a VALID key to `createHmac`, not a missing one: it produces a
    perfectly good digest that anyone can reproduce. Since `config.youverify` is absent until all
    four variables are set — the state of every unconfigured environment — a fallback of `''` behind
    this function would mean any stranger could sign a body and be believed. Fail closed instead.
  */
  if (secret.trim() === '') return false;

  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  // Providers spell a hex digest in either case; the bytes it denotes are the same.
  const received = header.trim().toLowerCase();
  if (received.length !== expected.length) return false;

  const receivedBytes = Buffer.from(received, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  // `Buffer.from(..., 'hex')` stops at the first non-hex character rather than throwing, so a
  // same-length-but-not-hex header would otherwise produce a short buffer and crash the compare.
  if (receivedBytes.length !== expectedBytes.length) return false;

  return timingSafeEqual(receivedBytes, expectedBytes);
}
