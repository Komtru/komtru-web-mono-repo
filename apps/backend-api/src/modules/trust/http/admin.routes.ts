// M6 §11's `/admin/kyc/*`, `STAFF` scope. The permissions are T-037's catalogue:
//
//   verification.view      read the queue and an item (with its advisory)
//   verification.review    take and decide an item
//   duplicate_flag.view    read the duplicate flags
//   duplicate_flag.resolve resolve one (clearing a false positive also needs a dual-approved override)
//   verification.override  ask for, and carry out, a level change outside the provider flow
//
//   GET  /admin/kyc/queue                       IDENTITY and KYB cases awaiting a person
//   GET  /admin/kyc/queue/:requestId            one item, with "AI-suggested — not a decision"
//   POST /admin/kyc/queue/:requestId/assign     take the case
//   POST /admin/kyc/queue/:requestId/decide     approve or reject (not a flagged request)
//   GET  /admin/kyc/duplicate-flags
//   POST /admin/kyc/duplicate-flags/:id/resolve
//   POST /admin/kyc/overrides                   step one: ask; a different holder approves
//   POST /admin/kyc/overrides/:approvalId/execute   step two: the requester carries it out
//
// Approving an override is `POST /admin/approvals/:id/approve` (T-037), the platform's one dual-approval
// path; this module does not grow a second.
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import * as admin from './admin.controller.js';
import type { TrustAdminDeps } from './admin.controller.js';
import {
  approvalIdParams,
  assignBody,
  assignResponse,
  decideBody,
  decideResponse,
  flagIdParams,
  flagResponse,
  flagsQuery,
  flagsResponse,
  overrideExecuteBody,
  overrideExecutedResponse,
  overrideRequestBody,
  overrideRequestedResponse,
  queueDetailResponse,
  queueQuery,
  queueResponse,
  requestIdParams,
  resolveFlagBody,
} from './admin.validations.js';

const READ_BUDGET = { points: 120, durationSeconds: 60, by: ['user' as const, 'ip' as const] };
const WRITE_BUDGET = { points: 30, durationSeconds: 60, by: ['user' as const, 'ip' as const] };

export function trustAdminRoutes(deps: TrustAdminDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'get',
      path: '/admin/kyc/queue',
      scope: 'STAFF',
      permission: 'verification.view',
      summary: 'KYC and KYB items waiting for a person',
      paginated: 'page',
      rateLimit: READ_BUDGET,
      schema: { query: queueQuery, response: queueResponse },
      handler: ({ query }) => admin.listQueueHandler(deps, query),
    }),

    defineRoute({
      method: 'get',
      path: '/admin/kyc/queue/:requestId',
      scope: 'STAFF',
      permission: 'verification.view',
      summary: 'One review item with its advisory suggestion',
      rateLimit: READ_BUDGET,
      schema: { params: requestIdParams, response: queueDetailResponse },
      handler: ({ params }) => admin.queueItemHandler(deps, params.requestId),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/kyc/queue/:requestId/assign',
      scope: 'STAFF',
      permission: 'verification.review',
      summary: 'Take a review item',
      retryable: true,
      rateLimit: WRITE_BUDGET,
      schema: { params: requestIdParams, body: assignBody, response: assignResponse },
      handler: (ctx) => admin.assignHandler(deps, ctx, ctx.params.requestId),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/kyc/queue/:requestId/decide',
      scope: 'STAFF',
      permission: 'verification.review',
      summary: 'Approve or reject a review item',
      retryable: true,
      rateLimit: WRITE_BUDGET,
      schema: { params: requestIdParams, body: decideBody, response: decideResponse },
      handler: (ctx) => admin.decideHandler(deps, ctx, ctx.params.requestId, ctx.body),
    }),

    defineRoute({
      method: 'get',
      path: '/admin/kyc/duplicate-flags',
      scope: 'STAFF',
      permission: 'duplicate_flag.view',
      summary: 'Duplicate-identity flags, newest first',
      paginated: 'page',
      rateLimit: READ_BUDGET,
      schema: { query: flagsQuery, response: flagsResponse },
      handler: ({ query }) => admin.listFlagsHandler(deps, query),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/kyc/duplicate-flags/:id/resolve',
      scope: 'STAFF',
      permission: 'duplicate_flag.resolve',
      summary: 'Confirm, clear (dual approval) or escalate a duplicate flag',
      retryable: true,
      rateLimit: WRITE_BUDGET,
      schema: { params: flagIdParams, body: resolveFlagBody, response: flagResponse },
      handler: (ctx) => admin.resolveFlagHandler(deps, ctx, ctx.params.id, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/kyc/overrides',
      scope: 'STAFF',
      permission: 'verification.override',
      summary: 'Ask for a verification override; a different holder must approve',
      status: 202,
      retryable: true,
      rateLimit: WRITE_BUDGET,
      schema: { body: overrideRequestBody, response: overrideRequestedResponse },
      handler: (ctx) => admin.requestOverrideHandler(deps, ctx, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/kyc/overrides/:approvalId/execute',
      scope: 'STAFF',
      permission: 'verification.override',
      summary: 'Carry out an approved level override',
      retryable: true,
      rateLimit: WRITE_BUDGET,
      schema: { params: approvalIdParams, body: overrideExecuteBody, response: overrideExecutedResponse },
      handler: (ctx) => admin.executeOverrideHandler(deps, ctx, ctx.params.approvalId, ctx.body),
    }),
  ];
}
