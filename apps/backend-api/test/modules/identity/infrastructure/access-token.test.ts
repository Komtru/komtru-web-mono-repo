import { createPrivateKey, randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../../src/config/env.js';
import {
  createTokenSigner,
  type AccessTokenClaims,
} from '../../../../src/modules/identity/infrastructure/jwt/access-token.js';
import { testRedisEnv, testRedisUrl } from '../../../support/db-urls.js';

const minimal = {
  POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
  REDIS_URL: testRedisUrl(),
  ...testRedisEnv(),
};

const configWith = (overrides: Record<string, string> = {}) =>
  loadConfig({
    ...minimal,
    IDENTITY_SIGNING_KEY: randomBytes(32).toString('hex'),
    IDENTITY_SIGNING_KEY_ID: 'k1',
    ...overrides,
  });

const claims: AccessTokenClaims = {
  sub: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b',
  sid: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5c',
  scp: 'CONSUMER',
  epc: 3,
};

const header = (token: string): unknown =>
  JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8'));

describe('access tokens', () => {
  it('round-trips the four claims M1 D5 names', async () => {
    const signer = createTokenSigner(configWith());
    expect(await signer.verify(await signer.sign(claims))).toEqual(claims);
  });

  it('signs with EdDSA and names the key', async () => {
    const signer = createTokenSigner(configWith());
    expect(header(await signer.sign(claims))).toMatchObject({ alg: 'EdDSA', kid: 'k1', typ: 'JWT' });
  });

  it('expires in the configured hour', async () => {
    const signer = createTokenSigner(configWith());
    expect(signer.ttlSeconds).toBe(3600);
    const token = await signer.sign(claims);
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
      iat: number;
      exp: number;
      iss: string;
      aud: string;
    };
    expect(payload.exp - payload.iat).toBe(3600);
    expect(payload).toMatchObject({ iss: 'https://api.komtru.com', aud: 'komtru' });
  });

  it('reports an expired token as expired, not as invalid', async () => {
    const signer = createTokenSigner(configWith({ IDENTITY_ACCESS_TOKEN_TTL_SECONDS: '60' }));
    const expired = await signer.sign(claims, { now: new Date(Date.now() - 600_000) });
    expect(await signer.verify(expired)).toEqual({ expired: true });
  });

  it('rejects a token from another key, a tampered one, and junk', async () => {
    const signer = createTokenSigner(configWith());
    const other = createTokenSigner(configWith());
    expect(await signer.verify(await other.sign(claims))).toBeNull();

    const [head, , signature] = (await signer.sign(claims)).split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, epc: 99 })).toString('base64url');
    expect(await signer.verify(`${head}.${forged}.${signature}`)).toBeNull();
    expect(await signer.verify('not.a.token')).toBeNull();
    expect(await signer.verify('')).toBeNull();
  });

  it('rejects an unsigned alg:none token', async () => {
    const signer = createTokenSigner(configWith());
    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
    expect(await signer.verify(unsigned)).toBeNull();
  });

  it('rejects a token signed for another issuer or audience', async () => {
    const signer = createTokenSigner(configWith());
    const stranger = createTokenSigner(configWith({ IDENTITY_TOKEN_AUDIENCE: 'somewhere-else' }));
    // Same claims, same shape, different audience: a token minted for another service must not work
    // here even if that service shares this key one day.
    expect(await stranger.verify(await signer.sign(claims))).toBeNull();
  });

  it('rejects a well-signed token whose claims are not a session', async () => {
    const config = configWith();
    const signer = createTokenSigner(config);
    // The same key the signer built, reconstructed the same way, so this token is genuinely ours.
    const key = createPrivateKey({
      key: Buffer.from(`302e020100300506032b657004220420${config.identity.signingKey ?? ''}`, 'hex'),
      format: 'der',
      type: 'pkcs8',
    });
    const partial = await new SignJWT({ sub: claims.sub })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'k1' })
      .setIssuedAt()
      .setIssuer('https://api.komtru.com')
      .setAudience('komtru')
      .setExpirationTime('10m')
      .sign(key);
    expect(await signer.verify(partial)).toBeNull();
  });

  it('publishes a JWKS with the public key and never the seed', () => {
    const config = configWith();
    const jwks = createTokenSigner(config).jwks();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ kty: 'OKP', crv: 'Ed25519', use: 'sig', alg: 'EdDSA', kid: 'k1' });
    expect(jwks.keys[0]).not.toHaveProperty('d');
    expect(JSON.stringify(jwks)).not.toContain(config.identity.signingKey);
  });

  it('fails naming IDENTITY_SIGNING_KEY when it is absent', () => {
    expect(() => createTokenSigner(loadConfig(minimal))).toThrow(/IDENTITY_SIGNING_KEY/);
  });
});
