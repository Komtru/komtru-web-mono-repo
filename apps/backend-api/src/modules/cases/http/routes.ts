// Staff routes (T-107), `STAFF` scope. Reads need `cases.view`; every change needs `cases.manage`
// (T-037's catalogue). Every list is cursor-paginated.
//
//   GET  /cases/queue?view=mine|unassigned|escalated|sla_at_risk   P0-01 tabs, with filters
//   GET  /cases/queue/counts                                       P0-01 tiles
//   GET  /cases                                                    the universal list (P0-02 search)
//   GET  /cases/:id                                                P0-02 overview, evidence, decisions
//   GET  /cases/:id/trail                                          P0-02 Trust Trail tab
//   GET  /cases/:id/advisory                                       "AI-suggested — not a decision"
//   POST /cases/:id/take | reassign | escalate | priority          work the case, a reason on the last three
//   POST /cases/:id/evidence-requests                              ask for evidence
//   POST /cases/:id/evidence-requests/:requestId/resolve           mark it fulfilled or cancelled
//   POST /cases/:id/decisions                                      the only route that records a decision
//
// The advisory is a GET: it is not a mutating route, and it has no decision to write.
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import { requireUserId } from '../../../platform/http/principal.js';
import { adviseOnCase } from '../services/advisory.service.js';
import {
  decideCase,
  escalateCase,
  reassignCase,
  requestEvidence,
  resolveEvidenceRequest,
  setCasePriority,
  takeCase,
} from '../services/case.service.js';
import { getCaseDetail, listCases, listQueue, listTrail, queueCounts } from '../services/read.service.js';
import { caseActor, requireReason, type CasesHttpDeps } from './context.js';
import {
  advisoryResponse,
  caseDetailResponse,
  caseListResponse,
  caseView,
  countsResponse,
  decisionBody,
  decisionResponse,
  escalateBody,
  evidenceBody,
  evidenceParams,
  evidenceResponse,
  idParams,
  listQuery,
  priorityBody,
  queueQuery,
  reassignBody,
  resolveEvidenceBody,
  trailResponse,
} from './validations.js';

const READ_BUDGET = { points: 240, durationSeconds: 60, by: ['user' as const, 'ip' as const] };
const WRITE_BUDGET = { points: 60, durationSeconds: 60, by: ['user' as const, 'ip' as const] };
const VIEW = 'cases.view';
const MANAGE = 'cases.manage';

export function caseRoutes(deps: CasesHttpDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'get',
      path: '/cases/queue',
      scope: 'STAFF',
      permission: VIEW,
      summary: 'The work queue: my work, unassigned, escalated or SLA at risk',
      paginated: 'cursor',
      rateLimit: READ_BUDGET,
      schema: { query: queueQuery, response: caseListResponse },
      handler: (ctx) => {
        const { view, ...filters } = ctx.query;
        return listQueue(deps.db(), {
          view,
          userId: requireUserId(ctx.actor, 'Sign in with a staff session'),
          filters,
          limit: ctx.query.limit ?? 20,
          cursor: ctx.cursor,
        });
      },
    }),

    defineRoute({
      method: 'get',
      path: '/cases/queue/counts',
      scope: 'STAFF',
      permission: VIEW,
      summary: 'The work queue tile counts',
      rateLimit: READ_BUDGET,
      schema: { response: countsResponse },
      handler: (ctx) => queueCounts(deps.db(), requireUserId(ctx.actor, 'Sign in with a staff session')),
    }),

    defineRoute({
      method: 'get',
      path: '/cases',
      scope: 'STAFF',
      permission: VIEW,
      summary: 'Every case, filterable by type, state, priority, owner, subject or case number',
      paginated: 'cursor',
      rateLimit: READ_BUDGET,
      schema: { query: listQuery, response: caseListResponse },
      handler: (ctx) =>
        listCases(deps.db(), { filters: ctx.query, limit: ctx.query.limit ?? 20, cursor: ctx.cursor }),
    }),

    defineRoute({
      method: 'get',
      path: '/cases/:id',
      scope: 'STAFF',
      permission: VIEW,
      summary: 'One case with its evidence requests and decisions',
      rateLimit: READ_BUDGET,
      schema: { params: idParams, response: caseDetailResponse },
      handler: (ctx) => getCaseDetail(deps.db(), ctx.params.id),
    }),

    defineRoute({
      method: 'get',
      path: '/cases/:id/trail',
      scope: 'STAFF',
      permission: VIEW,
      summary: 'A case’s trust trail, newest first',
      paginated: 'cursor',
      rateLimit: READ_BUDGET,
      schema: { params: idParams, response: trailResponse },
      handler: (ctx) =>
        listTrail(deps.db(), ctx.params.id, { limit: ctx.query.limit ?? 20, cursor: ctx.cursor }),
    }),

    defineRoute({
      method: 'get',
      path: '/cases/:id/advisory',
      scope: 'STAFF',
      permission: VIEW,
      summary: 'A suggestion and its rationale, labelled AI-suggested and never a decision',
      rateLimit: READ_BUDGET,
      schema: { params: idParams, response: advisoryResponse },
      handler: async (ctx) => adviseOnCase(deps.db(), ctx.params.id, deps.advisory()),
    }),

    defineRoute({
      method: 'post',
      path: '/cases/:id/take',
      scope: 'STAFF',
      permission: MANAGE,
      summary: 'Take an unowned case',
      retryable: true,
      rateLimit: WRITE_BUDGET,
      schema: { params: idParams, response: caseView },
      handler: (ctx) => takeCase(deps.db(), { actor: caseActor(ctx.actor, ctx.req), caseId: ctx.params.id }),
    }),

    defineRoute({
      method: 'post',
      path: '/cases/:id/reassign',
      scope: 'STAFF',
      permission: MANAGE,
      summary: 'Reassign a case to another handler; a reason is required',
      retryable: true,
      rateLimit: WRITE_BUDGET,
      schema: { params: idParams, body: reassignBody, response: caseView },
      handler: (ctx) =>
        reassignCase(deps.db(), {
          actor: caseActor(ctx.actor, ctx.req),
          caseId: ctx.params.id,
          toUserId: ctx.body.toUserId,
          reason: requireReason(ctx.req, ctx.body.reason),
        }),
    }),

    defineRoute({
      method: 'post',
      path: '/cases/:id/escalate',
      scope: 'STAFF',
      permission: MANAGE,
      summary: 'Escalate a case for an expert decision; a reason is required',
      retryable: true,
      rateLimit: WRITE_BUDGET,
      schema: { params: idParams, body: escalateBody, response: caseView },
      handler: (ctx) =>
        escalateCase(deps.db(), {
          actor: caseActor(ctx.actor, ctx.req),
          caseId: ctx.params.id,
          reason: requireReason(ctx.req, ctx.body.reason),
        }),
    }),

    defineRoute({
      method: 'post',
      path: '/cases/:id/priority',
      scope: 'STAFF',
      permission: MANAGE,
      summary: 'Change a case’s priority; a reason is required',
      retryable: true,
      rateLimit: WRITE_BUDGET,
      schema: { params: idParams, body: priorityBody, response: caseView },
      handler: (ctx) =>
        setCasePriority(deps.db(), {
          actor: caseActor(ctx.actor, ctx.req),
          caseId: ctx.params.id,
          priority: ctx.body.priority,
          reason: requireReason(ctx.req, ctx.body.reason),
        }),
    }),

    defineRoute({
      method: 'post',
      path: '/cases/:id/evidence-requests',
      scope: 'STAFF',
      permission: MANAGE,
      summary: 'Ask for evidence on a case',
      status: 201,
      retryable: true,
      rateLimit: WRITE_BUDGET,
      schema: { params: idParams, body: evidenceBody, response: evidenceResponse },
      handler: (ctx) =>
        requestEvidence(deps.db(), {
          actor: caseActor(ctx.actor, ctx.req),
          caseId: ctx.params.id,
          description: ctx.body.description,
          fromUserId: ctx.body.fromUserId,
          dueAt: ctx.body.dueAt ? new Date(ctx.body.dueAt) : undefined,
        }),
    }),

    defineRoute({
      method: 'post',
      path: '/cases/:id/evidence-requests/:requestId/resolve',
      scope: 'STAFF',
      permission: MANAGE,
      summary: 'Mark an evidence request fulfilled or cancelled',
      retryable: true,
      rateLimit: WRITE_BUDGET,
      schema: { params: evidenceParams, body: resolveEvidenceBody, response: evidenceResponse },
      handler: (ctx) =>
        resolveEvidenceRequest(deps.db(), {
          actor: caseActor(ctx.actor, ctx.req),
          caseId: ctx.params.id,
          requestId: ctx.params.requestId,
          status: ctx.body.status,
          note: ctx.body.note,
        }),
    }),

    defineRoute({
      method: 'post',
      path: '/cases/:id/decisions',
      scope: 'STAFF',
      permission: MANAGE,
      summary: 'Record a decision: an outcome, a reason and the policy it rests on',
      status: 201,
      retryable: true,
      rateLimit: WRITE_BUDGET,
      schema: { params: idParams, body: decisionBody, response: decisionResponse },
      handler: (ctx) =>
        decideCase(deps.db(), {
          actor: caseActor(ctx.actor, ctx.req),
          caseId: ctx.params.id,
          outcome: ctx.body.outcome,
          reason: requireReason(ctx.req, ctx.body.reason),
          policyCitation: ctx.body.policyCitation,
        }),
    }),
  ];
}
