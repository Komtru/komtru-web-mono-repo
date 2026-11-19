// M6 §11's user surface, declared with defineRoute — the only way a route is registered, so
// mountRoutes checks every one of these at boot for a scope, an explicit retryable decision and
// pagination on anything that returns a collection.
//
// No permission on any of them: these are a user acting on their own account, which is what the
// CONSUMER scope already proves. The §11 admin surface — the review queue and the duplicate flags —
// is T-052's, and it needs the RBAC rows T-037 adds.
import { pageRequestSchema } from '@komtru/shared-types';
import { requireUserId } from '../../../platform/http/principal.js';
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import * as controllers from './controllers.js';
import type { TrustHttpDeps } from './controllers.js';
import {
  addressBody,
  bankAccountBody,
  businessBody,
  bvnBody,
  claimIdParam,
  livenessAbandonResponse,
  livenessBody,
  livenessRequestIdParam,
  livenessSessionResponse,
  ninBody,
  socialProofBody,
  socialProofCheckResponse,
  socialProofListResponse,
  socialProofResponse,
  statusResponse,
  submissionResponse,
} from './validations.js';

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
      method: 'post',
      path: '/verification/liveness/session',
      scope: 'CONSUMER',
      summary: 'Open a browser liveness session and get what the provider SDK needs',
      // Each session is a billable provider interaction and holds the user's one in-flight slot.
      retryable: false,
      rateLimit: { ...SUBMISSION_LIMIT, by: [...SUBMISSION_LIMIT.by] },
      schema: { response: livenessSessionResponse },
      handler: ({ actor }) =>
        controllers.startLiveness(deps, { userId: requireUserId(actor, VERIFY_YOURSELF) }),
    }),

    defineRoute({
      method: 'post',
      path: '/verification/liveness/session/:requestId/abandon',
      scope: 'CONSUMER',
      summary: 'End a liveness session the person closed without finishing',
      // No idempotency key: a repeat is harmless by construction, the same reason the webhook
      // receiver needs none. Ownership and status live in the UPDATE's WHERE clause, so a second
      // close moves nothing and the service answers `abandoned: false` rather than a conflict.
      // This matters because the call goes out as the SDK's modal is closing, which is exactly
      // when a connection is most likely to drop and be retried.
      retryable: false,
      rateLimit: { ...SUBMISSION_LIMIT, by: [...SUBMISSION_LIMIT.by] },
      schema: { params: livenessRequestIdParam, response: livenessAbandonResponse },
      handler: ({ actor, params }) =>
        controllers.abandonLiveness(deps, {
          userId: requireUserId(actor, VERIFY_YOURSELF),
          requestId: params.requestId,
        }),
    }),

    defineRoute({
      method: 'post',
      path: '/verification/business',
      scope: 'CONSUMER',
      summary: 'Submit a CAC registration number; the registry check runs in the background',
      // Same reasoning as the identity submissions: `verification_requests_one_in_flight` makes a
      // repeat a 409 rather than a second billed call, and the job id is the request id.
      retryable: false,
      rateLimit: { ...SUBMISSION_LIMIT, by: [...SUBMISSION_LIMIT.by] },
      status: 202,
      schema: { body: businessBody, response: submissionResponse },
      handler: ({ actor, body }) =>
        controllers.submitBusiness(deps, { userId: requireUserId(actor, VERIFY_YOURSELF), body }),
    }),

    defineRoute({
      method: 'post',
      path: '/verification/bank-account',
      scope: 'CONSUMER',
      summary: 'Name-match a settlement account against the CAC-registered business name',
      retryable: false,
      rateLimit: { ...SUBMISSION_LIMIT, by: [...SUBMISSION_LIMIT.by] },
      status: 202,
      schema: { body: bankAccountBody, response: submissionResponse },
      handler: ({ actor, body }) =>
        controllers.submitBankAccount(deps, { userId: requireUserId(actor, VERIFY_YOURSELF), body }),
    }),

    defineRoute({
      method: 'post',
      path: '/verification/address',
      scope: 'CONSUMER',
      summary: 'Submit a proof of address for review; no provider is called',
      retryable: false,
      rateLimit: { ...SUBMISSION_LIMIT, by: [...SUBMISSION_LIMIT.by] },
      // 202 like the rest, and for a stronger reason: this one is waiting on a person, not a
      // provider, so a 201 claiming the check is done would be doubly wrong.
      status: 202,
      schema: { body: addressBody, response: submissionResponse },
      handler: ({ actor, body }) =>
        controllers.submitAddress(deps, { userId: requireUserId(actor, VERIFY_YOURSELF), body }),
    }),

    defineRoute({
      method: 'post',
      path: '/verification/social-proof',
      scope: 'CONSUMER',
      summary: 'Claim an Instagram or X handle and get the one-time code to publish',
      /**
       * The one submission in this module that DOES want an idempotency key.
       *
       * The others are protected by `verification_requests_one_in_flight`. This one is not: the
       * unique indexes on `social_proof_claims` are partial on `verified = true`, deliberately, so a
       * user may abandon a mistyped claim and start another. A retry on a flaky connection would
       * therefore succeed twice — issuing a second code and silently invalidating the one the user
       * has just gone and put in their bio.
       */
      retryable: true,
      rateLimit: { ...SUBMISSION_LIMIT, by: [...SUBMISSION_LIMIT.by] },
      // 201: unlike every other route here, this one really has created the thing it returns.
      status: 201,
      schema: { body: socialProofBody, response: socialProofResponse },
      handler: ({ actor, body }) =>
        controllers.claimSocialProof(deps, { userId: requireUserId(actor, VERIFY_YOURSELF), body }),
    }),

    defineRoute({
      method: 'post',
      path: '/verification/social-proof/:id/confirm',
      scope: 'CONSUMER',
      summary: 'Ask us to look for the challenge code on the claimed profile',
      // A repeat enqueues the same claim id, which the job treats as a redelivery, and the one-minute
      // `last_checked_at` interval refuses it anyway. Genuinely harmless.
      retryable: false,
      rateLimit: { ...SUBMISSION_LIMIT, by: [...SUBMISSION_LIMIT.by] },
      status: 202,
      schema: { params: claimIdParam, response: socialProofCheckResponse },
      handler: ({ actor, params }) =>
        controllers.confirmSocialProof(deps, {
          userId: requireUserId(actor, VERIFY_YOURSELF),
          claimId: params.id,
        }),
    }),

    defineRoute({
      method: 'get',
      path: '/verification/social-proof',
      scope: 'CONSUMER',
      summary: 'The handle claims on this account and whether each one is proved',
      // Paginated for real, not just declared: only the VERIFIED claims are capped at one per
      // platform, and the abandoned unverified ones beside them are not capped by anything.
      paginated: 'page',
      schema: { query: pageRequestSchema, response: socialProofListResponse },
      handler: ({ actor, query }) =>
        controllers.listSocialProofClaims(deps, {
          userId: requireUserId(actor, SEE_YOUR_STATUS),
          page: query.page,
          limit: query.limit,
        }),
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
