// Cannibalized from kumtru/backend-apis/src/modules/utils/encryption.ts (T-001), adapted: the key is
// an argument rather than a `config` singleton import, so the platform holds no global state, and the
// payload is validated before any `Buffer.from(..., 'hex')` — that call drops non-hex characters
// silently, and Node's GCM accepts an IV of any length, so a corrupt row would otherwise reach the
// cipher as a different, shorter nonce.
//
// AES-256-GCM for any third-party credential or user secret this service has to persist. GCM rather
// than CBC so the ciphertext is authenticated: a tampered row fails to decrypt instead of yielding
// garbage. The IV is random per call, so encrypting the same plaintext twice differs — never use this
// output as a lookup key; hash it (crypto/hmac.ts) instead.
//
// Wire format: `v1:<iv-hex>:<authTag-hex>:<ciphertext-hex>`.
import crypto from 'node:crypto';
import type { AppConfig } from '../../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export const ENCRYPTION_PREFIX = 'v1';

const MALFORMED = `Malformed ciphertext: expected ${ENCRYPTION_PREFIX}:<iv>:<tag>:<data>`;

const isHex = (value: string, bytes?: number): boolean =>
  /^[0-9a-fA-F]*$/.test(value) &&
  value.length % 2 === 0 &&
  (bytes === undefined || value.length === bytes * 2);

export function parseEncryptionKey(hex: string): Buffer {
  if (!isHex(hex, KEY_BYTES)) throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  return Buffer.from(hex, 'hex');
}

export function encrypt(key: Buffer, plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [
    ENCRYPTION_PREFIX,
    iv.toString('hex'),
    cipher.getAuthTag().toString('hex'),
    ciphertext.toString('hex'),
  ].join(':');
}

export function decrypt(key: Buffer, payload: string): string {
  const parts = payload.split(':');
  const [prefix, ivHex, tagHex, dataHex] = parts;

  // One message for every shape of malformed input: a caller that could tell "bad tag length" from
  // "wrong part count" learns nothing it can act on, and the distinction travels into logs.
  if (
    parts.length !== 4 ||
    prefix !== ENCRYPTION_PREFIX ||
    !isHex(ivHex as string, IV_BYTES) ||
    !isHex(tagHex as string, TAG_BYTES) ||
    !isHex(dataHex as string)
  ) {
    throw new Error(MALFORMED);
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex as string, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex as string, 'hex'));

  return Buffer.concat([decipher.update(Buffer.from(dataHex as string, 'hex')), decipher.final()]).toString(
    'utf8',
  );
}

/** True when `value` looks like output of `encrypt`, for migrating columns that hold a mix. */
export const isEncrypted = (value: string): boolean => {
  const parts = value.split(':');
  return parts.length === 4 && parts[0] === ENCRYPTION_PREFIX;
};

export interface Encryption {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
  /** The `bytea` form, for `*_enc` columns: the same wire string, stored as its UTF-8 bytes. */
  seal(plaintext: string): Buffer;
  open(sealed: Buffer): string;
}

/**
 * Binds the configured key once, so call sites never handle key material.
 *
 * For production the key should become a KMS-derived data key rather than a static env value; the
 * wire format is versioned, so a KMS-wrapped `v2:` is additive.
 */
export function createEncryption(config: AppConfig): Encryption {
  if (!config.crypto.encryptionKey) throw new Error('ENCRYPTION_KEY is not set; cannot encrypt');
  const key = parseEncryptionKey(config.crypto.encryptionKey);

  return {
    encrypt: (plaintext) => encrypt(key, plaintext),
    decrypt: (payload) => decrypt(key, payload),
    seal: (plaintext) => Buffer.from(encrypt(key, plaintext), 'utf8'),
    open: (sealed) => decrypt(key, sealed.toString('utf8')),
  };
}
