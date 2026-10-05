// Identity's session routes. `defineRoute` is the only way to register one (design §4.4), so the
// scope, the retry decision and the schemas are all declared here and checked at boot.
import { defineRoute, type RouteDefinition } from '../../../../platform/http/route.js';
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
       * Not "a repeat is harmless" — a repeat is a replay, and a replay kills the rotation family.
       * Declaring it retryable means a client that sends an `Idempotency-Key` gets the first result
       * replayed instead of spending its token twice when the response is lost on the way back.
       */
      retryable: true,
      // The refresh route is the one unauthenticated endpoint that mints credentials, so it is worth
      // a ceiling even though a wrong guess costs the attacker nothing but a 401.
      rateLimit: { points: 30, durationSeconds: 60, by: ['ip'] },
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
