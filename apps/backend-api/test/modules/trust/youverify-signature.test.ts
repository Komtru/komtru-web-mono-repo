// `x-yv-signature`: an HMAC-SHA256 hex digest of the request body, keyed with the webhook secret.
//
// The test that earns its place here is the last one. Youverify's own Node sample computes the
// digest over `JSON.stringify(req.body)` — the REPARSED body — and that is wrong in a way that only
// shows up for some deliveries: a parser does not preserve key order, whitespace or the escaping of
// non-ASCII characters, so a signature checked against a re-serialised body passes for plain ASCII
// payloads and fails once a name carries an accent. An authentication check that works for most
// inputs is worse than one that never works, because it ships.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyYouverifySignature } from '../../../src/modules/trust/infrastructure/providers/youverify.signature.js';

const SECRET = 'webhook-secret';
const sign = (raw: Buffer | string): string => createHmac('sha256', SECRET).update(raw).digest('hex');

describe('verifyYouverifySignature', () => {
  it('accepts a signature over the exact bytes that arrived', () => {
    const raw = Buffer.from('{"event":"identity.verification.completed"}');
    expect(verifyYouverifySignature(raw, sign(raw), SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const raw = Buffer.from('{"event":"identity.verification.completed"}');
    const signature = sign(raw);
    expect(verifyYouverifySignature(Buffer.from('{"event":"tampered"}'), signature, SECRET)).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    const raw = Buffer.from('{"a":1}');
    const other = createHmac('sha256', 'not-the-secret').update(raw).digest('hex');
    expect(verifyYouverifySignature(raw, other, SECRET)).toBe(false);
  });

  it('rejects a missing header rather than treating absence as valid', () => {
    const raw = Buffer.from('{"a":1}');
    expect(verifyYouverifySignature(raw, undefined, SECRET)).toBe(false);
    expect(verifyYouverifySignature(raw, '', SECRET)).toBe(false);
  });

  it('rejects a malformed header without throwing on the length mismatch', () => {
    const raw = Buffer.from('{"a":1}');
    expect(() => verifyYouverifySignature(raw, 'zz', SECRET)).not.toThrow();
    expect(verifyYouverifySignature(raw, 'zz', SECRET)).toBe(false);
    expect(verifyYouverifySignature(raw, 'not-hex-at-all!!', SECRET)).toBe(false);
  });

  it('is case-insensitive about the hex digest, which providers spell either way', () => {
    const raw = Buffer.from('{"a":1}');
    expect(verifyYouverifySignature(raw, sign(raw).toUpperCase(), SECRET)).toBe(true);
  });

  it('verifies a non-ASCII body on its raw bytes, where a re-serialised body would fail', () => {
    // A name with an accent: valid JSON, and `JSON.parse` then `JSON.stringify` does not reproduce
    // these bytes, because the original escapes the character and the round-trip does not.
    const raw = Buffer.from('{"name":"Ad\\u00e9bay\\u1ecd"}', 'utf8');
    const signature = sign(raw);
    expect(verifyYouverifySignature(raw, signature, SECRET)).toBe(true);

    const reserialised = Buffer.from(JSON.stringify(JSON.parse(raw.toString('utf8'))), 'utf8');
    expect(reserialised.equals(raw)).toBe(false);
    expect(verifyYouverifySignature(reserialised, signature, SECRET)).toBe(false);
  });
});
