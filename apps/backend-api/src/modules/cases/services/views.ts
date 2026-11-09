// How a case row is shown: the row, with its SLA worked out at the moment of asking.
import type { CaseState } from '../domain/types.js';
import { slaView, type SlaView } from '../domain/sla.js';
import { caseCode, type CaseFacts, type CasePriority, type CaseType } from '../domain/types.js';
import type { caseIndex } from '../infrastructure/postgres/schema/cases.js';
import type { caseDecisions } from '../infrastructure/postgres/schema/decisions.js';
import type { caseEvidenceRequests } from '../infrastructure/postgres/schema/evidence.js';
import type { caseTrail } from '../infrastructure/postgres/schema/trail.js';

export type CaseRow = typeof caseIndex.$inferSelect;
export type EvidenceRequestRow = typeof caseEvidenceRequests.$inferSelect;
export type DecisionRow = typeof caseDecisions.$inferSelect;
export type TrailRow = typeof caseTrail.$inferSelect;

export interface CaseView {
  id: string;
  caseNumber: number;
  code: string;
  type: CaseType;
  subjectType: string;
  subjectId: string;
  title: string;
  state: CaseState;
  priority: CasePriority;
  ownerUserId: string | null;
  sla: SlaView & { hours: number; startedAt: Date };
  escalatedAt: Date | null;
  decidedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CaseDetail extends CaseView {
  facts: CaseFacts;
  evidenceRequests: EvidenceRequestView[];
  decisions: DecisionView[];
}

export const toCaseView = (row: CaseRow, now: Date = new Date()): CaseView => ({
  id: row.id,
  caseNumber: row.caseNumber,
  code: caseCode(row.caseNumber),
  type: row.type,
  subjectType: row.subjectType,
  subjectId: row.subjectId,
  title: row.title,
  state: row.state,
  priority: row.priority,
  ownerUserId: row.ownerUserId,
  sla: {
    ...slaView({ state: row.state, dueAt: row.slaDueAt, slaHours: row.slaHours, now }),
    hours: row.slaHours,
    startedAt: row.slaStartedAt,
  },
  escalatedAt: row.escalatedAt,
  decidedAt: row.decidedAt,
  closedAt: row.closedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export interface EvidenceRequestView {
  id: string;
  caseId: string;
  description: string;
  fromUserId: string | null;
  requestedByUserId: string;
  status: EvidenceRequestRow['status'];
  dueAt: Date | null;
  resolvedByUserId: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  createdAt: Date;
}
export const toEvidenceView = (row: EvidenceRequestRow): EvidenceRequestView => ({ ...row });

export interface DecisionView {
  id: string;
  caseId: string;
  decidedByUserId: string;
  outcome: string;
  reason: string;
  policyCitation: string;
  decidedAt: Date;
}
export const toDecisionView = (row: DecisionRow): DecisionView => ({ ...row });

export interface TrailView {
  id: number;
  occurredAt: Date;
  type: TrailRow['type'];
  actorUserId: string | null;
  reason: string | null;
  metadata: unknown;
}
export const toTrailView = (row: TrailRow): TrailView => ({
  id: row.id,
  occurredAt: row.occurredAt,
  type: row.type,
  actorUserId: row.actorUserId,
  reason: row.reason,
  metadata: row.metadata,
});
