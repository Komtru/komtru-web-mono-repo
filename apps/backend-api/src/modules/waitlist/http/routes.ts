// The one route the marketing site calls.
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import type { Db } from '../../../db/index.js';
import { addSignup } from '../services/signups.service.js';
import { signupBody, signupResponse } from './validations.js';

/**
 * Per IP, because there is no user to count against — nobody on this route has an account.
 *
 * Ten a minute: generous for a household or an office behind one address, and far below what makes
 * a list worth flooding. Behind Nigerian carrier-grade NAT one IP is many unrelated people, which
 * is the argument against a tighter budget here; the unique index on the contact is what actually
 * bounds how many rows one person can create.
 */
const SIGNUP_BUDGET = { points: 10, durationSeconds: 60, by: ['ip' as const] };

export function waitlistRoutes(deps: { db: () => Db }): RouteDefinition[] {
  return [
    defineRoute({
      method: 'post',
      path: '/waitlist',
      scope: 'PUBLIC',
      summary: 'Join the launch waitlist from komtru.com',
      /*
       * `false` — a repeat is harmless, so no idempotency key is required. The unique index on the
       * contact is what makes that true: a second post of the same signup cannot create a second
       * row, it is answered 409, and the site reads that as success. Requiring a key instead would
       * put a header on a public form for no gain.
       */
      retryable: false,
      // It creates something, and says so.
      status: 201,
      rateLimit: SIGNUP_BUDGET,
      schema: { body: signupBody, response: signupResponse },
      handler: (ctx) => addSignup(deps.db(), signupBody.parse(ctx.body)),
    }),
  ];
}
