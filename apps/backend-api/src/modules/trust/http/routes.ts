// M6 §11's user surface, declared with defineRoute — the only way a route is registered, so
// mountRoutes checks every one of these at boot for a scope, an explicit retryable decision and
// pagination on anything that returns a collection.
//
// No permission on any of them: these are a user acting on their own account, which is what the
// CONSUMER scope already proves. The §11 admin surface — the review queue and the duplicate flags —
// is T-052's, and it needs the RBAC rows T-037 adds.
import { requireUserId } from '../../../platform/http/principal.js';
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import * as controllers from './controllers.js';
import type { TrustHttpDeps } from './controllers.js';
import { bvnBody, livenessBody, ninBody, statusResponse, submissionResponse } from './validations.js';

const VERIFY_YOURSELF = 'Sign in to verify your identity';
const SEE_YOUR_STATUS = 'Sign in to see your verification status';

/**
 * Five a minute, per IP and per user.
 *
 * Far looser than any honest person retyping a number, far tighter than anything that could run up
 * a provider bill. This is the only consumer surface in the platform where one request spends money
 * at a third party per call, so its budget is the strictest of the consumer routes.
 */
const SUBMISSION_LIMIT = { points: 5, durationSeconds: 60, by: ['ip', 'user'] as const };

export function trustRoutes(deps: TrustHttpDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'post',
      path: '/verification/nin',
      scope: 'CONSUMER',
      summary: 'Submit a NIN for verification; the provider check runs in the background',
      /**
       * Idempotent by construction: `verification_requests_one_in_flight` makes a repeat a 409
       * rather than a second provider call, and the job id is the request id. Making the caller
       * carry an idempotency key for a repeat the database already refuses is friction with no
       * safety behind it.
       */
      retryable: false,
      rateLimit: { ...SUBMISSION_LIMIT, by: [...SUBMISSION_LIMIT.by] },
      // 202, not 201: nothing is decided yet, and a client that reads 201 as "verified" is a client
      // that renders a green tick before the provider has been asked.
      status: 202,
      schema: { body: ninBody, response: submissionResponse },
      handler: ({ actor, body }) =>
        controllers.submitNin(deps, { userId: requireUserId(actor, VERIFY_YOURSELF), body }),
    }),

    defineRoute({
      method: 'post',
      path: '/verification/bvn',
      scope: 'CONSUMER',
      summary: 'Submit a BVN for verification; the provider check runs in the background',
      retryable: false,
      rateLimit: { ...SUBMISSION_LIMIT, by: [...SUBMISSION_LIMIT.by] },
      status: 202,
      schema: { body: bvnBody, response: submissionResponse },
      handler: ({ actor, body }) =>
        controllers.submitBvn(deps, { userId: requireUserId(actor, VERIFY_YOURSELF), body }),
    }),

    defineRoute({
      method: 'post',
      path: '/verification/liveness',
      scope: 'CONSUMER',
      summary: 'Submit a selfie, matched against the most recently verified NIN or BVN',
      retryable: false,
      rateLimit: { ...SUBMISSION_LIMIT, by: [...SUBMISSION_LIMIT.by] },
      status: 202,
      schema: { body: livenessBody, response: submissionResponse },
      handler: ({ actor, body }) =>
        controllers.submitLiveness(deps, { userId: requireUserId(actor, VERIFY_YOURSELF), body }),
    }),

    defineRoute({
      method: 'get',
      path: '/verification/status',
      scope: 'CONSUMER',
      summary: 'The caller’s verification level, what is still required, and what is in flight',
      // Not paginated: one object, and `inFlight` is bounded by the one-in-flight-per-type index to
      // at most one row per verification type.
      schema: { response: statusResponse },
      handler: ({ actor }) => controllers.status(deps, requireUserId(actor, SEE_YOUR_STATUS)),
    }),
  ];
}
