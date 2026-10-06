// Identity's session routes. `defineRoute` is the only way to register one (design §4.4), so the
// scope, the retry decision and the schemas are all declared here and checked at boot.
import { defineRoute, type RouteDefinition } from '../../../../platform/http/route.js';
import { refreshTokenHash } from '../../domain/session/refresh-token.js';
import { jwks, logout, refresh, type AuthControllerDeps } from '../controllers/auth.controller.js';
import {
  jwksResponseSchema,
  logoutRequestSchema,
  logoutResponseSchema,
  refreshRequestSchema,
  sessionResponseSchema,
} from '../validations/auth.validation.js';

export function authRoutes(deps: AuthControllerDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'get',
      /**
       * Served at `/v1/.well-known/jwks.json`, not at the origin root: every route this platform has
       * is mounted under `/v1`, and inventing a second mount point to put one file at the
       * conventional path would mean a route that `defineRoute` does not see. The edge can alias
       * `/.well-known/jwks.json` to it.
       */
      path: '/.well-known/jwks.json',
      scope: 'PUBLIC',
      summary: 'The public keys access tokens are signed with',
      schema: { response: jwksResponseSchema },
      handler: () => Promise.resolve(jwks(deps.signer)),
    }),

    defineRoute({
      method: 'post',
      path: '/auth/refresh',
      scope: 'PUBLIC',
      summary: 'Exchange a refresh token for a new session',
      /**
       * False, and not because a repeat is harmless — it is a replay that kills the family. The
       * idempotency gate stores a completed response in `platform.idempotency_keys.response` as
       * plaintext jsonb for 24 hours, and this response carries both the access token and the new
       * refresh token. Declaring it retryable would undo `sessions.refresh_token_hash`: a database
       * dump would become live credentials, and anyone who captured the whole request could get the
       * child token back with a 200 instead of tripping reuse detection. Rotation is its own retry
       * protocol — a lost response costs one family, which is what M1 D5 prescribes anyway.
       */
      retryable: false,
      /**
       * Two keys. Behind Nigerian carrier-grade NAT one IP is thousands of unrelated people, so the
       * per-IP budget has to be loose enough not to lock a whole city out of signing in — which
       * leaves it bounding resource use rather than abuse. The per-token key is what bounds abuse:
       * one credential's replay storm is capped however many IPs it arrives from. Neither bounds
       * guessing, and neither needs to; a 256-bit token is not guessed. The subject is the token's
       * SHA-256 — the same value the database stores, never the token itself.
       */
      rateLimit: {
        points: 300,
        durationSeconds: 60,
        by: ['ip', 'identifier'],
        identifierFrom: ({ body }) => {
          const token = (body as { refreshToken?: unknown }).refreshToken;
          return typeof token === 'string' ? refreshTokenHash(token).toString('hex') : undefined;
        },
      },
      schema: { body: refreshRequestSchema, response: sessionResponseSchema },
      handler: (ctx) => refresh(deps, ctx.req, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/auth/logout',
      /**
       * PUBLIC, not CONSUMER: the access token has very likely expired by the time a user presses
       * sign out, and refusing to end a session because its access token lapsed is exactly backwards.
       * The refresh token in the body is the credential.
       */
      scope: 'PUBLIC',
      summary: 'End a session, or every session on every device',
      /** Revoking an already-revoked session is genuinely harmless, so no key is needed. */
      retryable: false,
      rateLimit: { points: 60, durationSeconds: 60, by: ['ip'] },
      schema: { body: logoutRequestSchema, response: logoutResponseSchema },
      handler: (ctx) => logout(deps, ctx.body),
    }),
  ];
}
