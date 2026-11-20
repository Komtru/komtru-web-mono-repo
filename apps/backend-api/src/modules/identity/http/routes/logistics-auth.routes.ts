// Logistics sign-in (T-086): a separate route, not a flag on `/auth/login` (the staff C2 pattern, m2
// §2). Rate-limited like staff sign-in, and counted into the same identifier bucket as every other
// password door onto the same account.
import { defineRoute, type RouteDefinition } from '../../../../platform/http/route.js';
import { logisticsSignIn, logisticsVerifyMfa } from '../controllers/logistics-auth.controller.js';
import type { PasswordControllerDeps } from '../controllers/password.controller.js';
import {
  loginRequestSchema,
  loginResponseSchema,
  mfaVerifyRequestSchema,
  sessionBodySchema,
} from '../validations/password.validation.js';
import { mfaFingerprint, mfaTokenSubject } from './mfa.routes.js';
import { loginIdentifier } from './password.routes.js';

export function logisticsAuthRoutes(deps: PasswordControllerDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'post',
      path: '/auth/logistics/login',
      scope: 'PUBLIC',
      summary: 'Logistics portal sign-in: a LOGISTICS session for a member of a logistics company',
      /** False for `/auth/login`'s reason: a repeat is a second session or challenge, never a double effect. */
      retryable: false,
      rateLimit: {
        points: 5,
        durationSeconds: 60,
        by: ['identifier', 'ip', 'device'],
        perKey: { ip: { points: 20, durationSeconds: 60 } },
        identifierBucket: 'password-login',
        identifierFrom: loginIdentifier,
        deviceFrom: mfaFingerprint,
      },
      schema: { body: loginRequestSchema, response: loginResponseSchema },
      handler: (ctx) => logisticsSignIn(deps, ctx.req, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/auth/logistics/mfa/verify',
      scope: 'PUBLIC',
      summary: 'Logistics portal sign-in, step two: present a second factor and open a LOGISTICS session',
      retryable: false,
      rateLimit: {
        points: 10,
        durationSeconds: 60,
        by: ['ip', 'identifier', 'device'],
        identifierFrom: mfaTokenSubject,
        deviceFrom: mfaFingerprint,
      },
      schema: { body: mfaVerifyRequestSchema, response: sessionBodySchema },
      handler: (ctx) => logisticsVerifyMfa(deps, ctx.req, ctx.body),
    }),
  ];
}
