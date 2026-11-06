// Staff sign-in (T-037): two routes, password then second factor. A STAFF session is never issued
// from a password alone, and the consumer routes never issue one at all.
import { defineRoute, type RouteDefinition } from '../../../../platform/http/route.js';
import { staffSignIn, staffVerifyMfa } from '../controllers/staff-auth.controller.js';
import type { PasswordControllerDeps } from '../controllers/password.controller.js';
import {
  loginChallengeSchema,
  loginRequestSchema,
  mfaVerifyRequestSchema,
  sessionBodySchema,
} from '../validations/password.validation.js';
import { mfaFingerprint, mfaTokenSubject } from './mfa.routes.js';
import { loginIdentifier } from './password.routes.js';

export function staffAuthRoutes(deps: PasswordControllerDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'post',
      path: '/auth/staff/login',
      scope: 'PUBLIC',
      summary: 'Staff sign-in, step one: the password buys an MFA challenge, never a session',
      /** False for `/auth/login`'s reason, and a repeat is a harmless second challenge. */
      retryable: false,
      // Tighter than consumer login on the IP key: staff sign in from known networks, and there is
      // no carrier-grade-NAT crowd to protect on this route.
      rateLimit: {
        points: 5,
        durationSeconds: 60,
        by: ['identifier', 'ip', 'device'],
        perKey: { ip: { points: 10, durationSeconds: 60 } },
        identifierFrom: loginIdentifier,
        deviceFrom: mfaFingerprint,
      },
      schema: { body: loginRequestSchema, response: loginChallengeSchema },
      handler: (ctx) => staffSignIn(deps, ctx.req, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/auth/staff/mfa/verify',
      scope: 'PUBLIC',
      summary: 'Staff sign-in, step two: present a second factor and open a STAFF session',
      retryable: false,
      rateLimit: {
        points: 10,
        durationSeconds: 60,
        by: ['ip', 'identifier', 'device'],
        identifierFrom: mfaTokenSubject,
        deviceFrom: mfaFingerprint,
      },
      schema: { body: mfaVerifyRequestSchema, response: sessionBodySchema },
      handler: (ctx) => staffVerifyMfa(deps, ctx.req, ctx.body),
    }),
  ];
}
