import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyPaystackSignature } from '../../../src/modules/ledger/infrastructure/providers/paystack/signature.js';

const SECRET = 'sk_test_not_a_real_key';
const BODY = Buffer.from('{"event":"charge.success","data":{"reference":"trade_fund_1"}}', 'utf8');

/** Computed the way Paystack documents it, so the test pins the scheme rather than the code. */
const sign = (secret: string, body: Buffer): string =>
  createHmac('sha512', secret).update(body).digest('hex');

describe('verifyPaystackSignature', () => {
  it('accepts a real signature', () => {
    expect(verifyPaystackSignature(SECRET, BODY, sign(SECRET, BODY))).toBe(true);
  });

  it('accepts an empty body with its own signature', () => {
    const empty = Buffer.alloc(0);
    expect(verifyPaystackSignature(SECRET, empty, sign(SECRET, empty))).toBe(true);
  });

  it('ignores the hex case, which is not contractual', () => {
    expect(verifyPaystackSignature(SECRET, BODY, sign(SECRET, BODY).toUpperCase())).toBe(true);
  });

  it('rejects a body changed by one byte', () => {
    const tampered = Buffer.from(BODY);
    tampered.writeUInt8(tampered.readUInt8(12) ^ 0x01, 12);
    expect(verifyPaystackSignature(SECRET, tampered, sign(SECRET, BODY))).toBe(false);
  });

  it('rejects a signature made with another secret', () => {
    expect(verifyPaystackSignature(SECRET, BODY, sign('sk_test_other', BODY))).toBe(false);
  });

  it('fails closed without a secret, even against an empty-key HMAC', () => {
    // The defect this pins: hashing with '' would make every forged request verify.
    const forged = createHmac('sha512', Buffer.alloc(1)).update(BODY).digest('hex');
    expect(verifyPaystackSignature(undefined, BODY, sign(SECRET, BODY))).toBe(false);
    expect(verifyPaystackSignature('', BODY, forged)).toBe(false);
    expect(verifyPaystackSignature(undefined, BODY, forged)).toBe(false);
  });

  const malformed: [string, string | undefined][] = [
    ['absent', undefined],
    ['empty', ''],
    ['a prefix', '0x'],
    ['one hex digit short', sign(SECRET, BODY).slice(0, 127)],
    ['one hex digit long', `${sign(SECRET, BODY)}0`],
    ['the right length but not hex', 'z'.repeat(128)],
    // Node joins duplicate headers with ', '; a sender that sets two must not get one accepted.
    ['two signatures joined', `${sign(SECRET, BODY)}, ${sign(SECRET, BODY)}`],
    ['padded with whitespace', ` ${sign(SECRET, BODY)} `],
  ];

  it.each(malformed)('rejects a header that is %s, without throwing', (_name, header) => {
    expect(verifyPaystackSignature(SECRET, BODY, header)).toBe(false);
  });
});
