// Cannibalized from kumtru/backend-apis/src/modules/ledger/infrastructure/providers/paystack/webhook.ts
// (T-001), with the hex handling rewritten — see below.
//
// Pure: no I/O, no config read, no network. That is what lets the webhook route call it inline while
// `client.ts` stays importable only from jobs/ (design §4.4, T-028).
import { providerHmac, timingSafeEqualBuffers } from '../../../../../platform/crypto/hmac.js';

/** Paystack's signature is 64 bytes of SHA-512 rendered as hex; nothing else is a candidate. */
const HEX_SIGNATURE = /^[0-9a-fA-F]{128}$/;

/**
 * HMAC-SHA512 of the RAW request body, hex, against `x-paystack-signature` (m8 §5).
 *
 * `rawBody` must be the bytes Paystack sent, not a reparsed body — `platform/http/raw-body.ts` explains
 * why and how the route gets them.
 *
 * Fails CLOSED, returning false and never throwing:
 *
 *  - with no secret. An absent `PAYSTACK_SECRET_KEY` must never make every delivery verify against an
 *    empty-key HMAC, which anyone can compute.
 *  - for a header that is not exactly 128 hex characters. The cannibalized version compared the header
 *    as a string, which was fine; the tempting "improvement" is `Buffer.from(header, 'hex')`, and that
 *    is the trap: Node stops at the first invalid pair and returns a SHORT buffer, so `0x...` decodes
 *    to one byte and a length-equal comparison against a one-byte prefix of the digest is a signature
 *    check an attacker passes in 256 tries. The header is therefore never hex-decoded at all — the two
 *    128-character ASCII strings are compared, in constant time, as bytes.
 *
 * The case fold is on the attacker-supplied header, not on the secret or the digest, so it leaks
 * nothing: both operands are fixed-length by the time they are compared.
 */
export function verifyPaystackSignature(
  secret: string | undefined,
  rawBody: Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (!secret || !signatureHeader) return false;
  if (!HEX_SIGNATURE.test(signatureHeader)) return false;

  const expected = providerHmac('sha512', secret, rawBody).toString('hex');

  return timingSafeEqualBuffers(
    Buffer.from(expected, 'utf8'),
    Buffer.from(signatureHeader.toLowerCase(), 'utf8'),
  );
}
