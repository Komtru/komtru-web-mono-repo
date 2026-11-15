// T-055's routes. Applicant routes are CONSUMER scope and act only on the caller's own application.
// Staff routes are STAFF scope, every one paginated where it lists, behind `merchant.application.view`
// (reads) or `merchant.application.decide` (taking and deciding):
//
//   GET  /merchant/applications/me                       status, and the draft to fill in
//   PUT  /merchant/applications/me                       save the draft (fields and documents)
//   POST /merchant/applications/:id/submit               422 without the CAC documents
//   POST /merchant/applications/:id/resubmit             after changes were requested
//
//   GET  /admin/merchant/applications                    the queue, sorted by SLA risk
//   GET  /admin/merchant/applications/count              what awaits review (the sidebar's number)
//   GET  /admin/merchant/applications/:id                one application and its evidence (signs nothing)
//   GET  /admin/merchant/applications/:id/documents/:docType   one document, signed on request and logged
//   POST /admin/merchant/applications/:id/assign         take the case
//   POST /admin/merchant/applications/:id/approve        one transaction
//   POST /admin/merchant/applications/:id/request-changes
//   POST /admin/merchant/applications/:id/reject
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import * as http from './controllers.js';
import type { MerchantHttpDeps } from './controllers.js';
import {
  applicantViewSchema,
  applicationIdParams,
  approveBody,
  assignBody,
  assignResponse,
  countResponse,
  decisionResponse,
  detailResponse,
  documentParams,
  documentViewResponse,
  draftBody,
  myApplicationResponse,
  queueQuery,
  queueResponse,
  rejectBody,
  requestChangesBody,
} from './validations.js';

const READ_BUDGET = { points: 120, durationSeconds: 60, by: ['user' as const, 'ip' as const] };
const WRITE_BUDGET = { points: 30, durationSeconds: 60, by: ['user' as const, 'ip' as const] };
// Saving a draft is a screen of the form at a time, so it is allowed more often than a decision is.
const DRAFT_BUDGET = { points: 60, durationSeconds: 60, by: ['user' as const, 'ip' as const] };

export function merchantRoutes(deps: MerchantHttpDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'get',
      path: '/merchant/applications/me',
      scope: 'CONSUMER',
      summary: 'Your merchant application, or null before you start one',
      rateLimit: READ_BUDGET,
      schema: { response: myApplicationResponse },
      handler: (ctx) => http.myApplicationHandler(deps, ctx),
    }),

    defineRoute({
      method: 'put',
      path: '/merchant/applications/me',
      scope: 'CONSUMER',
      summary: 'Save your merchant application draft',
      retryable: true,
      rateLimit: DRAFT_BUDGET,
      schema: { body: draftBody, response: applicantViewSchema },
      handler: (ctx) => http.saveDraftHandler(deps, ctx, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/merchant/applications/:id/submit',
      scope: 'CONSUMER',
      summary: 'Submit your merchant application for review',
      retryable: true,
      rateLimit: WRITE_BUDGET,
      schema: { params: applicationIdParams, body: assignBody, response: applicantViewSchema },
      handler: (ctx) => http.submitHandler(deps, ctx, ctx.params.id, 'SUBMIT'),
    }),

    defineRoute({
      method: 'post',
      path: '/merchant/applications/:id/resubmit',
      scope: 'CONSUMER',
      summary: 'Resubmit your merchant application after the changes we asked for',
      retryable: true,
      rateLimit: WRITE_BUDGET,
      schema: { params: applicationIdParams, body: assignBody, response: applicantViewSchema },
      handler: (ctx) => http.submitHandler(deps, ctx, ctx.params.id, 'RESUBMIT'),
    }),

    defineRoute({
      method: 'get',
      path: '/admin/merchant/applications',
      scope: 'STAFF',
      permission: 'merchant.application.view',
      summary: 'Merchant applications awaiting a person, by SLA risk',
      paginated: 'page',
      rateLimit: READ_BUDGET,
      schema: { query: queueQuery, response: queueResponse },
      handler: ({ query }) => http.listHandler(deps, query),
    }),

    // Registered before `/:id`, so "count" is never read as an application id.
    defineRoute({
      method: 'get',
      path: '/admin/merchant/applications/count',
      scope: 'STAFF',
      permission: 'merchant.application.view',
      summary: 'How many merchant applications await review',
      rateLimit: READ_BUDGET,
      schema: { response: countResponse },
      handler: () => http.countHandler(deps),
    }),

    defineRoute({
      method: 'get',
      path: '/admin/merchant/applications/:id',
      scope: 'STAFF',
      permission: 'merchant.application.view',
      summary: 'One merchant application with its evidence and signed documents',
      rateLimit: READ_BUDGET,
      schema: { params: applicationIdParams, response: detailResponse },
      handler: (ctx) => http.detailHandler(deps, ctx.params.id),
    }),

    // The one place a KYC document is signed: on request, one at a time, and written to
    // `file_access_log`. Opening the application above signs nothing.
    defineRoute({
      method: 'get',
      path: '/admin/merchant/applications/:id/documents/:docType',
      scope: 'STAFF',
      permission: 'merchant.application.view',
      summary: 'Open one document of an application under review: a short-lived signed link, logged',
      rateLimit: READ_BUDGET,
      schema: { params: documentParams, response: documentViewResponse },
      handler: (ctx) => http.documentHandler(deps, ctx, ctx.params.id, ctx.params.docType),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/merchant/applications/:id/assign',
      scope: 'STAFF',
      permission: 'merchant.application.decide',
      summary: 'Take a merchant application for review',
      retryable: true,
      rateLimit: WRITE_BUDGET,
      schema: { params: applicationIdParams, body: assignBody, response: assignResponse },
      handler: (ctx) => http.assignHandler(deps, ctx, ctx.params.id),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/merchant/applications/:id/approve',
      scope: 'STAFF',
      permission: 'merchant.application.decide',
      summary: 'Approve a merchant application: certification in one transaction',
      retryable: true,
      rateLimit: WRITE_BUDGET,
      schema: { params: applicationIdParams, body: approveBody, response: decisionResponse },
      handler: (ctx) => http.approveHandler(deps, ctx, ctx.params.id, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/merchant/applications/:id/request-changes',
      scope: 'STAFF',
      permission: 'merchant.application.decide',
      summary: 'Ask the applicant to change named documents or fields',
      retryable: true,
      rateLimit: WRITE_BUDGET,
      schema: { params: applicationIdParams, body: requestChangesBody, response: decisionResponse },
      handler: (ctx) => http.requestChangesHandler(deps, ctx, ctx.params.id, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/merchant/applications/:id/reject',
      scope: 'STAFF',
      permission: 'merchant.application.decide',
      summary: 'Reject a merchant application',
      retryable: true,
      rateLimit: WRITE_BUDGET,
      schema: { params: applicationIdParams, body: rejectBody, response: decisionResponse },
      handler: (ctx) => http.rejectHandler(deps, ctx, ctx.params.id, ctx.body),
    }),
  ];
}
