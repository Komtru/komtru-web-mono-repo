// The universal case endpoints the TrustOps console calls (T-141). Mirrors
// `apps/backend-api/src/modules/cases/http/validations.ts` field for field; dates arrive as ISO strings.
//
// The advisory is a read (`GET /cases/:id/advisory`) with a fixed label, and the decision body is a
// strict object of outcome, reason and citation: nothing the advisory said can ride along in it.
import { paginatedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { defineEndpoint } from './contracts.js';

export const CASE_TYPES = [
  'DISPUTE',
  'KYB',
  'MERCHANT_APPLICATION',
  'IDENTITY',
  'FRAUD',
  'CUSTODY',
  'PAYMENT_EXCEPTION',
  'TRADE_PROPOSAL',
  'PARK_HUB_APPLICATION',
] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const CASE_STATES = [
  'OPEN',
  'INVESTIGATING',
  'AWAITING_EVIDENCE',
  'ESCALATED',
  'DECIDED',
  'CLOSED',
] as const;
export type CaseState = (typeof CASE_STATES)[number];

export const CASE_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];

export const CASE_QUEUE_VIEWS = ['mine', 'unassigned', 'escalated', 'sla_at_risk'] as const;
export type CaseQueueView = (typeof CASE_QUEUE_VIEWS)[number];

export const TRAIL_TYPES = [
  'REGISTERED',
  'TAKEN',
  'REASSIGNED',
  'PRIORITY_CHANGED',
  'ESCALATED',
  'EVIDENCE_REQUESTED',
  'EVIDENCE_RESOLVED',
  'FACTS_UPDATED',
  'DECISION_RECORDED',
  'CLOSED',
] as const;
export type CaseTrailType = (typeof TRAIL_TYPES)[number];

/** The advisory's one fixed label (backend `ADVISORY_LABEL`). */
export const CASE_ADVISORY_LABEL = 'AI-suggested — not a decision';

const iso = z.iso.datetime();

export const caseViewSchema = z.object({
  id: z.uuid(),
  caseNumber: z.number().int().positive(),
  code: z.string(),
  type: z.enum(CASE_TYPES),
  subjectType: z.string(),
  subjectId: z.string(),
  title: z.string(),
  state: z.enum(CASE_STATES),
  priority: z.enum(CASE_PRIORITIES),
  ownerUserId: z.uuid().nullable(),
  sla: z.object({
    status: z.enum(['ON_TRACK', 'AT_RISK', 'BREACHED', 'STOPPED']),
    dueAt: iso,
    remainingMinutes: z.number().int().nullable(),
    hours: z.number().int().positive(),
    startedAt: iso,
  }),
  escalatedAt: iso.nullable(),
  decidedAt: iso.nullable(),
  closedAt: iso.nullable(),
  createdAt: iso,
  updatedAt: iso,
});
export type CaseView = z.infer<typeof caseViewSchema>;

export const evidenceRequestSchema = z.object({
  id: z.uuid(),
  caseId: z.uuid(),
  description: z.string(),
  fromUserId: z.uuid().nullable(),
  requestedByUserId: z.uuid(),
  status: z.enum(['OPEN', 'FULFILLED', 'CANCELLED']),
  dueAt: iso.nullable(),
  resolvedByUserId: z.uuid().nullable(),
  resolvedAt: iso.nullable(),
  resolutionNote: z.string().nullable(),
  createdAt: iso,
});
export type EvidenceRequest = z.infer<typeof evidenceRequestSchema>;

export const caseDecisionSchema = z.object({
  id: z.uuid(),
  caseId: z.uuid(),
  decidedByUserId: z.uuid(),
  outcome: z.string(),
  reason: z.string(),
  policyCitation: z.string(),
  decidedAt: iso,
});
export type CaseDecision = z.infer<typeof caseDecisionSchema>;

export const caseDetailSchema = caseViewSchema.extend({
  facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  evidenceRequests: z.array(evidenceRequestSchema),
  decisions: z.array(caseDecisionSchema),
});
export type CaseDetail = z.infer<typeof caseDetailSchema>;

export const caseTrailEntrySchema = z.object({
  id: z.number().int(),
  occurredAt: iso,
  type: z.enum(TRAIL_TYPES),
  actorUserId: z.uuid().nullable(),
  reason: z.string().nullable(),
  metadata: z.unknown(),
});
export type CaseTrailEntry = z.infer<typeof caseTrailEntrySchema>;

export const caseCountsSchema = z.object({
  mine: z.number().int(),
  mineUrgent: z.number().int(),
  unassigned: z.number().int(),
  escalated: z.number().int(),
  slaAtRisk: z.number().int(),
});
export type CaseCounts = z.infer<typeof caseCountsSchema>;

export const caseAdvisorySchema = z.object({
  label: z.literal(CASE_ADVISORY_LABEL),
  source: z.string(),
  suggestion: z.string(),
  rationale: z.array(z.string()),
});
export type CaseAdvisory = z.infer<typeof caseAdvisorySchema>;

const pageQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.int().min(1).max(100).optional(),
});

const filters = {
  type: z.enum(CASE_TYPES).optional(),
  priority: z.enum(CASE_PRIORITIES).optional(),
  state: z.enum(CASE_STATES).optional(),
  subjectType: z.string().min(1).max(60).optional(),
  subjectId: z.string().min(1).max(120).optional(),
  q: z.string().min(1).max(20).optional(),
};

const caseParams = z.object({ id: z.uuid() });
const caseList = paginatedSchema(caseViewSchema);

export const listCaseQueue = defineEndpoint({
  method: 'get',
  path: '/cases/queue',
  scope: 'STAFF',
  paginated: 'cursor',
  schema: {
    query: pageQuery.extend({ view: z.enum(CASE_QUEUE_VIEWS).optional(), ...filters }),
    response: caseList,
  },
});

export const caseQueueCounts = defineEndpoint({
  method: 'get',
  path: '/cases/queue/counts',
  scope: 'STAFF',
  schema: { response: caseCountsSchema },
});

export const listCases = defineEndpoint({
  method: 'get',
  path: '/cases',
  scope: 'STAFF',
  paginated: 'cursor',
  schema: {
    query: pageQuery.extend({ owner: z.union([z.uuid(), z.literal('none')]).optional(), ...filters }),
    response: caseList,
  },
});

export const getCase = defineEndpoint({
  method: 'get',
  path: '/cases/:id',
  scope: 'STAFF',
  schema: { params: caseParams, response: caseDetailSchema },
});

export const listCaseTrail = defineEndpoint({
  method: 'get',
  path: '/cases/:id/trail',
  scope: 'STAFF',
  paginated: 'cursor',
  schema: { params: caseParams, query: pageQuery, response: paginatedSchema(caseTrailEntrySchema) },
});

export const getCaseAdvisory = defineEndpoint({
  method: 'get',
  path: '/cases/:id/advisory',
  scope: 'STAFF',
  schema: { params: caseParams, response: caseAdvisorySchema },
});

const reason = z.string().max(1000).optional();

export const takeCase = defineEndpoint({
  method: 'post',
  path: '/cases/:id/take',
  scope: 'STAFF',
  retryable: true,
  schema: { params: caseParams, response: caseViewSchema },
});

export const reassignCase = defineEndpoint({
  method: 'post',
  path: '/cases/:id/reassign',
  scope: 'STAFF',
  retryable: true,
  schema: {
    params: caseParams,
    body: z.strictObject({ toUserId: z.uuid(), reason }),
    response: caseViewSchema,
  },
});

export const escalateCase = defineEndpoint({
  method: 'post',
  path: '/cases/:id/escalate',
  scope: 'STAFF',
  retryable: true,
  schema: { params: caseParams, body: z.strictObject({ reason }), response: caseViewSchema },
});

export const setCasePriority = defineEndpoint({
  method: 'post',
  path: '/cases/:id/priority',
  scope: 'STAFF',
  retryable: true,
  schema: {
    params: caseParams,
    body: z.strictObject({ priority: z.enum(CASE_PRIORITIES), reason }),
    response: caseViewSchema,
  },
});

export const requestCaseEvidence = defineEndpoint({
  method: 'post',
  path: '/cases/:id/evidence-requests',
  scope: 'STAFF',
  retryable: true,
  schema: {
    params: caseParams,
    body: z.strictObject({
      description: z.string().trim().min(1).max(2000),
      fromUserId: z.uuid().optional(),
      dueAt: iso.optional(),
    }),
    response: z.object({ case: caseViewSchema, request: evidenceRequestSchema }),
  },
});

export const resolveCaseEvidence = defineEndpoint({
  method: 'post',
  path: '/cases/:id/evidence-requests/:requestId/resolve',
  scope: 'STAFF',
  retryable: true,
  schema: {
    params: z.object({ id: z.uuid(), requestId: z.uuid() }),
    body: z.strictObject({
      status: z.enum(['FULFILLED', 'CANCELLED']),
      note: z.string().trim().min(1).max(1000).optional(),
    }),
    response: z.object({ case: caseViewSchema, request: evidenceRequestSchema }),
  },
});

export const decideCase = defineEndpoint({
  method: 'post',
  path: '/cases/:id/decisions',
  scope: 'STAFF',
  retryable: true,
  schema: {
    params: caseParams,
    body: z.strictObject({
      outcome: z.string().trim().min(1).max(80),
      reason: z.string().max(2000).optional(),
      policyCitation: z.string().trim().min(1).max(200),
    }),
    response: z.object({ case: caseViewSchema, decision: caseDecisionSchema }),
  },
});
