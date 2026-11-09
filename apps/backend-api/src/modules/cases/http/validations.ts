// Schemas for the cases routes. `reason` is optional in the body schemas ON PURPOSE, as in geo's and
// identity's admin schemas: a schema failure is a 422 and the admin surface answers a missing reason
// with a 400, so `requireReason` owns that check (and also reads `X-Admin-Reason`).
//
// Every body is a `strictObject`: a decision body that carries an unknown member, an advisory
// payload among them, is refused rather than quietly ignored.
import { paginatedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { ADVISORY_LABEL } from '../domain/advisory.js';
import {
  CASE_PRIORITIES,
  CASE_STATES,
  CASE_TYPES,
  EVIDENCE_REQUEST_STATUSES,
  TRAIL_TYPES,
} from '../domain/types.js';
import { QUEUE_VIEWS } from '../services/read.service.js';

export const idParams = z.object({ id: z.uuid() });
export const evidenceParams = z.object({ id: z.uuid(), requestId: z.uuid() });

const filters = {
  type: z.enum(CASE_TYPES).optional(),
  priority: z.enum(CASE_PRIORITIES).optional(),
  state: z.enum(CASE_STATES).optional(),
  subjectType: z.string().min(1).max(60).optional(),
  subjectId: z.string().min(1).max(120).optional(),
  q: z.string().min(1).max(20).optional(),
};

export const queueQuery = z.object({
  view: z.enum(QUEUE_VIEWS).default('mine'),
  ...filters,
});

export const listQuery = z.object({
  owner: z.union([z.uuid(), z.literal('none')]).optional(),
  ...filters,
});

const reason = z.string().max(1000).optional();

export const reassignBody = z.strictObject({ toUserId: z.uuid(), reason });
export const escalateBody = z.strictObject({ reason });
export const priorityBody = z.strictObject({ priority: z.enum(CASE_PRIORITIES), reason });
export const evidenceBody = z.strictObject({
  description: z.string().trim().min(1).max(2000),
  fromUserId: z.uuid().optional(),
  dueAt: z.iso.datetime().optional(),
});
export const resolveEvidenceBody = z.strictObject({
  status: z.enum(['FULFILLED', 'CANCELLED']),
  note: z.string().trim().min(1).max(1000).optional(),
});
export const decisionBody = z.strictObject({
  outcome: z.string().trim().min(1).max(80),
  reason: z.string().max(2000).optional(),
  policyCitation: z.string().trim().min(1).max(200),
});

const sla = z.object({
  status: z.enum(['ON_TRACK', 'AT_RISK', 'BREACHED', 'STOPPED']),
  dueAt: z.date(),
  remainingMinutes: z.number().int().nullable(),
  hours: z.number().int().positive(),
  startedAt: z.date(),
});

export const caseView = z.object({
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
  sla,
  escalatedAt: z.date().nullable(),
  decidedAt: z.date().nullable(),
  closedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const evidenceView = z.object({
  id: z.uuid(),
  caseId: z.uuid(),
  description: z.string(),
  fromUserId: z.uuid().nullable(),
  requestedByUserId: z.uuid(),
  status: z.enum(EVIDENCE_REQUEST_STATUSES),
  dueAt: z.date().nullable(),
  resolvedByUserId: z.uuid().nullable(),
  resolvedAt: z.date().nullable(),
  resolutionNote: z.string().nullable(),
  createdAt: z.date(),
});

const decisionView = z.object({
  id: z.uuid(),
  caseId: z.uuid(),
  decidedByUserId: z.uuid(),
  outcome: z.string(),
  reason: z.string(),
  policyCitation: z.string(),
  decidedAt: z.date(),
});

export const caseListResponse = paginatedSchema(caseView);
export const caseDetailResponse = caseView.extend({
  facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  evidenceRequests: z.array(evidenceView),
  decisions: z.array(decisionView),
});
export const trailResponse = paginatedSchema(
  z.object({
    id: z.number().int(),
    occurredAt: z.date(),
    type: z.enum(TRAIL_TYPES),
    actorUserId: z.uuid().nullable(),
    reason: z.string().nullable(),
    metadata: z.unknown(),
  }),
);
export const countsResponse = z.object({
  mine: z.number().int(),
  mineUrgent: z.number().int(),
  unassigned: z.number().int(),
  escalated: z.number().int(),
  slaAtRisk: z.number().int(),
});
export const evidenceResponse = z.object({ case: caseView, request: evidenceView });
export const decisionResponse = z.object({ case: caseView, decision: decisionView });
export const advisoryResponse = z.object({
  label: z.literal(ADVISORY_LABEL),
  source: z.string(),
  suggestion: z.string(),
  rationale: z.array(z.string()),
});
