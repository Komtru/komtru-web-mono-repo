// The stateless half of M1 D5: a short-lived (an hour; ten minutes for staff) EdDSA (Ed25519) JWT carrying `sub`, `sid`, `scp` and
// `epc`, verifiable by anything holding the JWKS.
//
// The claims are the *minimum* needed to find the session again, never a cache of what the caller
// may do. Roles, permissions, status and membership are re-read from Postgres on every request
// (design §7.3), so this token being valid is a necessary condition and never a sufficient one.
import crypto from 'node:crypto';
import { sessionScopeSchema, type SessionScope } from '@komtru/shared-types';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { z } from 'zod';
import type { AppConfig } from '../../../../config/env.js';

/**
 * The DER prefix of a PKCS#8-wrapped Ed25519 private key; the 32-byte seed follows it. The
 * environment holds the raw seed (64 hex characters), not a PEM, so the key is reconstructed here
 * rather than parsed — and the public half is derived from it, so there is no second variable that
 * can fall out of sync with the private one.
 */
const PKCS8_ED25519_PREFIX = '302e020100300506032b657004220420';

const claimsSchema = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  scp: sessionScopeSchema,
  epc: z.number().int().min(1),
});

export interface AccessTokenClaims {
  /** The user. */
  sub: string;
  /** The session row this token was minted from. */
  sid: string;
  scp: SessionScope;
  /** `users.sessions_epoch` at minting time — the kill switch (M1 D5). */
  epc: number;
}

/** `{ expired: true }` is deliberately not `null`: only an expired token is worth a refresh. */
export type VerifyResult = AccessTokenClaims | { expired: true } | null;

export interface TokenSigner {
  sign: (claims: AccessTokenClaims, options?: { now?: Date }) => Promise<string>;
  verify: (token: string) => Promise<VerifyResult>;
  /** RFC 7517 key set for `GET /.well-known/jwks.json`; public material only. */
  jwks: () => { keys: Record<string, unknown>[] };
  /** The configured lifetime (`IDENTITY_ACCESS_TOKEN_TTL_SECONDS`), which consumer and logistics tokens get. */
  ttlSeconds: number;
  /** The lifetime a token of this scope is minted with: `ttlSeconds`, capped for staff. */
  ttlFor: (scope: SessionScope) => number;
}

/**
 * Staff tokens stay at ten minutes whatever the configured lifetime. A staff session's idle window is
 * 30 minutes and only slides when the client refreshes, which it does when its token expires; a token
 * that outlived the idle window would sign an active staff member out every half hour (M1 C3).
 */
export const STAFF_ACCESS_TOKEN_TTL_SECONDS = 600;

const lifetimeFor = (configured: number, scope: SessionScope): number =>
  scope === 'STAFF' ? Math.min(configured, STAFF_ACCESS_TOKEN_TTL_SECONDS) : configured;

const isExpiry = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_JWT_EXPIRED';

export function createTokenSigner(config: AppConfig): TokenSigner {
  const { signingKey, signingKeyId, accessTokenTtlSeconds, tokenIssuer, tokenAudience } = config.identity;
  if (!signingKey) {
    throw new Error('IDENTITY_SIGNING_KEY is not set: the API cannot issue or verify access tokens');
  }
  if (!signingKeyId) {
    throw new Error('IDENTITY_SIGNING_KEY_ID is not set: a JWKS needs a kid to name its key');
  }

  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(`${PKCS8_ED25519_PREFIX}${signingKey}`, 'hex'),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = crypto.createPublicKey(privateKey);
  const jwk = publicKey.export({ format: 'jwk' });

  return {
    ttlSeconds: accessTokenTtlSeconds,
    ttlFor: (scope) => lifetimeFor(accessTokenTtlSeconds, scope),

    sign: (claims, { now = new Date() } = {}) =>
      new SignJWT({ ...claims })
        .setProtectedHeader({ alg: 'EdDSA', kid: signingKeyId, typ: 'JWT' })
        .setIssuedAt(now)
        .setIssuer(tokenIssuer)
        .setAudience(tokenAudience)
        .setExpirationTime(new Date(now.getTime() + lifetimeFor(accessTokenTtlSeconds, claims.scp) * 1000))
        .sign(privateKey),

    verify: async (token) => {
      let payload: JWTPayload;
      try {
        // `algorithms` is not decoration: without it a token announcing `alg: none`, or an HMAC
        // signed with the public key as its secret, would be considered on its own say-so.
        ({ payload } = await jwtVerify(token, publicKey, {
          algorithms: ['EdDSA'],
          issuer: tokenIssuer,
          audience: tokenAudience,
          clockTolerance: 5,
        }));
      } catch (error) {
        return isExpiry(error) ? { expired: true } : null;
      }
      // A signature proves provenance, not shape. A token missing `sid`, `scp` or `epc` would
      // otherwise produce a half-filled principal rather than a refusal.
      const parsed = claimsSchema.safeParse(payload);
      return parsed.success ? parsed.data : null;
    },

    // Exported from the *public* KeyObject, so there is no path by which the seed reaches this list.
    // One key today; the array is the shape a rotation will need.
    jwks: () => ({ keys: [{ ...jwk, kid: signingKeyId, use: 'sig', alg: 'EdDSA' }] }),
  };
}
