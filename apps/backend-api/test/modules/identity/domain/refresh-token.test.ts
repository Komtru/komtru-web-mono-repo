import { describe, expect, it } from 'vitest';
import {
  issueRefreshToken,
  refreshTokenHash,
} from '../../../../src/modules/identity/domain/session/refresh-token.js';
import { sha256 } from '../../../../src/platform/crypto/hmac.js';

describe('refresh tokens', () => {
  it('mints 256 bits of opaque randomness and the SHA-256 that is stored in its place', () => {
    const { token, hash } = issueRefreshToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hash).toEqual(sha256(token));
    expect(hash).toHaveLength(32);
  });

  it('never repeats a token', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => issueRefreshToken().token));
    expect(tokens.size).toBe(200);
  });

  it('hashes a presented token the same way it hashed the minted one', () => {
    const { token, hash } = issueRefreshToken();
    expect(refreshTokenHash(token)).toEqual(hash);
    expect(refreshTokenHash(`${token}x`)).not.toEqual(hash);
  });
});
