// Every staff change to a case is one transaction holding the change, its trust-trail row, the admin
// action row (identity's audit log until T-103's own `admin_action_log` exists) and the outbox
// event. A change that cannot be explained afterwards does not happen.
import { writeAudit } from '../../identity/index.js';
import type { Tx } from '../../../platform/events/publish.js';
import { caseTrail } from '../infrastructure/postgres/schema/trail.js';
import type { TrailType } from '../domain/types.js';

export const CASE_AUDIT = {
  TAKEN: 'ADMIN_CASE_TAKEN',
  REASSIGNED: 'ADMIN_CASE_REASSIGNED',
  ESCALATED: 'ADMIN_CASE_ESCALATED',
  PRIORITY_CHANGED: 'ADMIN_CASE_PRIORITY_CHANGED',
  EVIDENCE_REQUESTED: 'ADMIN_CASE_EVIDENCE_REQUESTED',
  EVIDENCE_RESOLVED: 'ADMIN_CASE_EVIDENCE_RESOLVED',
  DECIDED: 'ADMIN_CASE_DECIDED',
} as const;

export interface CaseActor {
  userId: string;
  sessionId?: string | undefined;
  ip?: string | null;
  userAgent?: string | null;
}

export const staffActorEvent = (actor: CaseActor) => ({ type: 'STAFF' as const, id: actor.userId });

export const writeCaseAudit = (
  tx: Tx,
  actor: CaseActor,
  action: (typeof CASE_AUDIT)[keyof typeof CASE_AUDIT],
  metadata: Record<string, unknown>,
) =>
  writeAudit(tx, {
    action,
    outcome: 'SUCCESS',
    actorType: 'STAFF',
    actorUserId: actor.userId,
    sessionId: actor.sessionId ?? null,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
    metadata,
  });

export interface TrailInput {
  caseId: string;
  type: TrailType;
  /** Null when the system acts: an owning module registering, updating or closing a case. */
  actorUserId: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

export const writeTrail = async (tx: Tx, input: TrailInput): Promise<void> => {
  await tx.insert(caseTrail).values({
    caseId: input.caseId,
    type: input.type,
    actorUserId: input.actorUserId,
    reason: input.reason ?? null,
    metadata: input.metadata ?? null,
  });
};
