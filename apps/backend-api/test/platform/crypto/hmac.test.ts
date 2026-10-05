import { createHash, createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createHmacHasher,
  hmac,
  providerHmac,
  sha256,
  timingSafeEqualBuffers,
} from '../../../src/platform/crypto/hmac.js';

const key = randomBytes(32);
const otherKey = randomBytes(32);

describe('hmac', () => {
  it('is deterministic and 32 bytes', () => {
    const digest = hmac(key, 'identity.otp', '482913');
    expect(digest).toHaveLength(32);
    expect(hmac(key, 'identity.otp', '482913').equals(digest)).toBe(true);
  });

  it('separates domains', () => {
    expect(hmac(key, 'identity.otp', '482913').equals(hmac(key, 'identity.invite', '482913'))).toBe(false);
  });

  it('separates an ambiguous domain/value split', () => {
    // The old `${domain} ${value}` framing hashed these two identically.
    expect(hmac(key, 'otp a', 'b').equals(hmac(key, 'otp', 'a b'))).toBe(false);
  });

  it('depends on the key', () => {
    expect(hmac(key, 'identity.otp', '482913').equals(hmac(otherKey, 'identity.otp', '482913'))).toBe(false);
  });

  it('accepts a string key and a buffer value interchangeably with their byte forms', () => {
    const pepper = 'pepper-from-env';
    expect(
      hmac(pepper, 'identity.otp', '482913').equals(
        hmac(Buffer.from(pepper, 'utf8'), 'identity.otp', Buffer.from('482913', 'utf8')),
      ),
    ).toBe(true);
  });

  it('rejects an empty key', () => {
    expect(() => hmac('', 'identity.otp', '482913')).toThrow(/key/i);
  });
});

describe('sha256', () => {
  it('matches the unkeyed digest of the same bytes', () => {
    const expected = createHash('sha256').update('komtru').digest();
    expect(sha256('komtru').equals(expected)).toBe(true);
    expect(sha256(Buffer.from('komtru', 'utf8')).equals(expected)).toBe(true);
  });
});

describe('timingSafeEqualBuffers', () => {
  it('compares equal buffers as equal', () => {
    expect(timingSafeEqualBuffers(Buffer.from('abc'), Buffer.from('abc'))).toBe(true);
    expect(timingSafeEqualBuffers(Buffer.alloc(0), Buffer.alloc(0))).toBe(true);
  });

  it('reports different buffers of the same length as unequal', () => {
    expect(timingSafeEqualBuffers(Buffer.from('abc'), Buffer.from('abd'))).toBe(false);
  });

  it('reports unequal lengths as false without throwing', () => {
    expect(timingSafeEqualBuffers(Buffer.from('a'), randomBytes(32))).toBe(false);
    expect(timingSafeEqualBuffers(Buffer.alloc(0), Buffer.from('a'))).toBe(false);
  });
});

describe('createHmacHasher', () => {
  it('binds a key and verifies a digest', () => {
    const hasher = createHmacHasher(key);
    const stored = hasher.hmac('identity.otp', '482913');
    expect(hasher.matches('identity.otp', '482913', stored)).toBe(true);
    expect(hasher.matches('identity.otp', '482914', stored)).toBe(false);
    expect(hasher.matches('identity.invite', '482913', stored)).toBe(false);
  });

  it('does not throw when the stored digest is the wrong length', () => {
    const hasher = createHmacHasher(key);
    expect(hasher.matches('identity.otp', '482913', Buffer.from('short'))).toBe(false);
  });

  it('rejects an empty key', () => {
    expect(() => createHmacHasher('')).toThrow(/key/i);
  });
});

describe('providerHmac', () => {
  const body = Buffer.from('{"event":"charge.success"}', 'utf8');

  it("is the provider's own scheme: no domain framing", () => {
    expect(providerHmac('sha512', key, body).equals(createHmac('sha512', key).update(body).digest())).toBe(
      true,
    );
    expect(providerHmac('sha256', key, body).equals(createHmac('sha256', key).update(body).digest())).toBe(
      true,
    );
  });

  it('treats a string key and value as their utf8 bytes', () => {
    expect(
      providerHmac('sha512', 'secret', '{}').equals(
        providerHmac('sha512', Buffer.from('secret', 'utf8'), Buffer.from('{}', 'utf8')),
      ),
    ).toBe(true);
  });

  it('refuses an empty key', () => {
    expect(() => providerHmac('sha512', '', body)).toThrow(/non-empty key/);
  });
});
