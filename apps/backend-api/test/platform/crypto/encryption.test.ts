import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../src/config/env.js';
import {
  createEncryption,
  decrypt,
  encrypt,
  ENCRYPTION_PREFIX,
  isEncrypted,
  parseEncryptionKey,
} from '../../../src/platform/crypto/encryption.js';
import { testRedisEnv, testRedisUrl } from '../../support/db-urls.js';

const key = randomBytes(32);
const otherKey = randomBytes(32);

/** Flips one hex character of the named field, leaving the payload well-formed. */
const tamper = (payload: string, field: 'iv' | 'tag' | 'data'): string => {
  const parts = payload.split(':');
  const index = { iv: 1, tag: 2, data: 3 }[field];
  const original = parts[index] as string;
  parts[index] = (original[0] === '0' ? '1' : '0') + original.slice(1);
  return parts.join(':');
};

describe('encrypt/decrypt', () => {
  it.each([
    ['empty', ''],
    ['unicode', 'héllo ⚡ naïve'],
    ['long', 'x'.repeat(2048)],
  ])('round-trips %s plaintext', (_label, plaintext) => {
    expect(decrypt(key, encrypt(key, plaintext))).toBe(plaintext);
  });

  it('produces a different ciphertext each time for the same plaintext', () => {
    const a = encrypt(key, 'secret');
    const b = encrypt(key, 'secret');
    expect(a).not.toBe(b);
    expect(decrypt(key, a)).toBe('secret');
    expect(decrypt(key, b)).toBe('secret');
  });

  it('writes the v1 wire format', () => {
    expect(ENCRYPTION_PREFIX).toBe('v1');
    expect(encrypt(key, 'secret')).toMatch(/^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
  });

  it.each(['iv', 'tag', 'data'] as const)('fails to decrypt when the %s is tampered with', (field) => {
    expect(() => decrypt(key, tamper(encrypt(key, 'secret'), field))).toThrow();
  });

  it('fails to decrypt under a different key', () => {
    expect(() => decrypt(otherKey, encrypt(key, 'secret'))).toThrow();
  });

  it.each(['v2:aa:bb:cc', 'v1:aa:bb', 'v1:aa:bb:cc:dd', 'not-encrypted', ''])(
    'rejects the malformed payload %s',
    (payload) => {
      expect(() => decrypt(key, payload)).toThrow(/Malformed ciphertext/);
    },
  );

  it('rejects a payload whose iv or tag is the wrong length or not hex', () => {
    const payload = encrypt(key, 'secret');
    const [, iv, tag, data] = payload.split(':') as [string, string, string, string];
    expect(() => decrypt(key, `v1:${iv.slice(0, 22)}:${tag}:${data}`)).toThrow(/Malformed ciphertext/);
    expect(() => decrypt(key, `v1:${iv}:${tag.slice(0, 30)}zz:${data}`)).toThrow(/Malformed ciphertext/);
    expect(() => decrypt(key, `v1:${iv}:${tag}:${data.slice(0, -1)}`)).toThrow(/Malformed ciphertext/);
  });

  it('recognises its own output and nothing else', () => {
    expect(isEncrypted(encrypt(key, 'secret'))).toBe(true);
    for (const value of ['', 'plain', 'v1:aa:bb', 'v2:aa:bb:cc']) expect(isEncrypted(value)).toBe(false);
  });

  it.each(['v1:::', 'v1:a:b:c', 'v1:zz:bb:cc'])(
    'does not call %s encrypted when decrypt would reject it',
    (value) => {
      // A migration that holds a mix branches on isEncrypted; "encrypted but undecryptable" sends
      // the row down the wrong branch.
      expect(isEncrypted(value)).toBe(false);
      expect(() => decrypt(key, value)).toThrow(/Malformed ciphertext/);
    },
  );
});

describe('parseEncryptionKey', () => {
  it('accepts 64 hex characters in either case', () => {
    expect(parseEncryptionKey('A'.repeat(64))).toHaveLength(32);
  });

  it.each(['', 'a'.repeat(63), 'a'.repeat(66), `${'a'.repeat(62)}zz`])('rejects %s', (value) => {
    expect(() => parseEncryptionKey(value)).toThrow(/64 hex characters/);
  });
});

describe('createEncryption', () => {
  const config = (encryptionKey?: string) =>
    loadConfig({
      POSTGRES_URL: 'postgresql://x@localhost/x',
      REDIS_URL: testRedisUrl(),
      ...testRedisEnv(),
      ...(encryptionKey ? { ENCRYPTION_KEY: encryptionKey } : {}),
    });

  it('binds the configured key', () => {
    const crypto = createEncryption(config(key.toString('hex')));
    expect(crypto.decrypt(crypto.encrypt('secret'))).toBe('secret');
  });

  it('fails loudly without a key, naming the variable', () => {
    expect(() => createEncryption(config())).toThrow(/ENCRYPTION_KEY/);
  });

  it('seals to a buffer and opens it again', () => {
    const crypto = createEncryption(config(key.toString('hex')));
    const sealed = crypto.seal('totp-seed');
    expect(Buffer.isBuffer(sealed)).toBe(true);
    expect(crypto.open(sealed)).toBe('totp-seed');
  });
});
