// T-039: the account lifecycle surface.
//
//   GET  /me                              who I am, and the account state behind AS1, AS2, CA1
//   POST /me/close                        close my account (CA2): password, and no trade in progress
//   POST /me/data-export                  NDPA portability request (M1 §15)
//   POST /me/erasure-request              NDPA erasure: closes the account, then compliance decides
//   POST /auth/recovery-requests          public: ask for help getting back in (M1 §5.8)
//   GET  /admin/recovery-requests         the review queue
//   POST /admin/recovery-requests/:id/decision   approve or reject
import { defineRoute, type RouteDefinition } from '../../../../platform/http/route.js';
import {
  getMe,
  getRecoveryQueue,
  postClose,
  postDataExport,
  postErasure,
  postRecoveryDecision,
  postRecoveryRequest,
  type LifecycleControllerDeps,
} from '../controllers/lifecycle.controller.js';
import {
  closeAccountBody,
  closeAccountResponse,
  dataExportResponse,
  erasureResponse,
  meResponse,
  recoveryDecisionBody,
  recoveryDecisionResponse,
  recoveryIdParams,
  recoveryIntakeBody,
  recoveryListResponse,
  recoveryQuery,
  recoveryReceiptResponse,
} from '../validations/lifecycle.validation.js';
import { loginIdentifier } from './password.routes.js';

const OWN_BUDGET = { points: 30, durationSeconds: 60, by: ['user', 'ip'] as const };
const STAFF_BUDGET = { points: 120, durationSeconds: 60, by: ['user' as const, 'ip' as const] };
const STAFF_WRITE_BUDGET = { points: 30, durationSeconds: 60, by: ['user' as const, 'ip' as const] };

export function lifecycleRoutes(deps: LifecycleControllerDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'get',
      path: '/me',
      scope: 'CONSUMER',
      summary: 'My profile summary and the state of my account',
      rateLimit: { ...OWN_BUDGET, by: [...OWN_BUDGET.by] },
      schema: { response: meResponse },
      handler: (ctx) => getMe(deps, ctx.actor),
    }),

    defineRoute({
      method: 'post',
      path: '/me/close',
      scope: 'CONSUMER',
      summary: 'Close my account (screens CA1, CA2)',
      /** False: the body holds a password, and the idempotency gate stores completed requests as plaintext. */
      retryable: false,
      // A password is checked, so the budget is tight: five tries a minute is a typo, not a guess.
      rateLimit: { points: 5, durationSeconds: 60, by: ['user', 'ip'] },
      schema: { body: closeAccountBody, response: closeAccountResponse },
      handler: (ctx) => postClose(deps, ctx.req, ctx.actor, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/me/data-export',
      scope: 'CONSUMER',
      summary: 'Ask for a copy of my data (NDPA portability)',
      status: 202,
      /** A repeat inside a day returns the first receipt, so a retry is already harmless. */
      retryable: false,
      rateLimit: { points: 5, durationSeconds: 3600, by: ['user', 'ip'] },
      schema: { response: dataExportResponse },
      handler: (ctx) => postDataExport(deps, ctx.req, ctx.actor),
    }),

    defineRoute({
      method: 'post',
      path: '/me/erasure-request',
      scope: 'CONSUMER',
      summary: 'Ask for my personal data to be erased (NDPA erasure)',
      status: 202,
      retryable: false,
      rateLimit: { points: 5, durationSeconds: 60, by: ['user', 'ip'] },
      schema: { body: closeAccountBody, response: erasureResponse },
      handler: (ctx) => postErasure(deps, ctx.req, ctx.actor, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/auth/recovery-requests',
      scope: 'PUBLIC',
      summary: 'Ask for help getting back into an account',
      status: 202,
      /** The same body whether or not the account exists, and a repeat returns the open request. */
      retryable: false,
      // Three an hour per identifier, as password reset: the flow opens a ticket a human must read.
      rateLimit: {
        points: 3,
        durationSeconds: 3600,
        by: ['identifier', 'ip'],
        perKey: { ip: { points: 20, durationSeconds: 3600 } },
        identifierBucket: 'account-recovery',
        identifierFrom: loginIdentifier,
      },
      schema: { body: recoveryIntakeBody, response: recoveryReceiptResponse },
      handler: (ctx) => postRecoveryRequest(deps, ctx.req, ctx.body),
    }),

    defineRoute({
      method: 'get',
      path: '/admin/recovery-requests',
      scope: 'STAFF',
      // Plan, owner decision 6: reviewing recovery reuses `user.reinstate`, the nearest "restore access".
      permission: 'user.reinstate',
      summary: 'Account recovery requests awaiting review',
      paginated: 'page',
      rateLimit: STAFF_BUDGET,
      schema: { query: recoveryQuery, response: recoveryListResponse },
      handler: (ctx) => getRecoveryQueue(deps, ctx.req, ctx.actor, ctx.query),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/recovery-requests/:id/decision',
      scope: 'STAFF',
      permission: 'user.reinstate',
      summary: 'Approve or reject an account recovery request',
      retryable: true,
      rateLimit: STAFF_WRITE_BUDGET,
      schema: { params: recoveryIdParams, body: recoveryDecisionBody, response: recoveryDecisionResponse },
      handler: (ctx) => postRecoveryDecision(deps, ctx.req, ctx.actor, ctx.params.id, ctx.body),
    }),
  ];
}
