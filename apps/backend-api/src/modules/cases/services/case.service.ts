// The staff write path for a case (T-107): take, reassign, escalate, re-prioritise, ask for evidence,
// resolve a request for it, and decide. One transaction each, holding a row lock on the case, the
// change, its trust-trail row, the admin action row and the outbox event.
import { and, count, eq, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { permissionsForRole, isKnownRole, liveRoleCodes } from '../../identity/index.js';
import {
  assigneeNotEligible,
  caseAlreadyOwned,
  caseNotFound,
  evidenceRequestNotFound,
  evidenceRequestResolved,
  notCaseOwner,
} from '../domain/errors.js';
import { caseAssigned, caseDecided, caseEscalated } from '../domain/events.js';
import {
  assertWorkable,
  stateAfterAssignment,
  stateAfterEscalation,
  stateAfterEvidenceRequested,
  stateAfterEvidenceResolved,
} from '../domain/lifecycle.js';
import type { CasePriority, EvidenceRequestStatus } from '../domain/types.js';
import { caseIndex } from '../infrastructure/postgres/schema/cases.js';
import { caseDecisions } from '../infrastructure/postgres/schema/decisions.js';
import { caseEvidenceRequests } from '../infrastructure/postgres/schema/evidence.js';
import { CASE_AUDIT, staffActorEvent, writeCaseAudit, writeTrail, type CaseActor } from './audit.js';
import { eventRef } from './register.service.js';
import {
  toCaseView,
  toDecisionView,
  toEvidenceView,
  type CaseRow,
  type CaseView,
  type DecisionView,
  type EvidenceRequestView,
} from './views.js';

const MANAGE = 'cases.manage';

async function lockCase(tx: Tx, caseId: string): Promise<CaseRow> {
  const [row] = await tx.select().from(caseIndex).where(eq(caseIndex.id, caseId)).for('update');
  if (!row) throw caseNotFound();
  return row;
}

async function save(tx: Tx, row: CaseRow, set: Partial<typeof caseIndex.$inferInsert>): Promise<CaseRow> {
  const [updated] = await tx
    .update(caseIndex)
    .set({ ...set, updatedAt: sql`now()` })
    .where(eq(caseIndex.id, row.id))
    .returning();
  if (!updated) throw caseNotFound();
  return updated;
}

/** A reassignment target must be somebody who could work the case: a live role carrying `cases.manage`. */
async function assertCanManageCases(tx: Tx, userId: string): Promise<void> {
  const roles = await liveRoleCodes(tx, userId);
  const eligible = roles.some((role) => isKnownRole(role) && permissionsForRole(role).includes(MANAGE));
  if (!eligible) throw assigneeNotEligible();
}

export async function takeCase(db: Db, input: { actor: CaseActor; caseId: string }): Promise<CaseView> {
  return db.transaction(async (tx) => {
    const row = await lockCase(tx, input.caseId);
    assertWorkable(row.state);
    if (row.ownerUserId === input.actor.userId) return toCaseView(row);
    if (row.ownerUserId) throw caseAlreadyOwned(row.ownerUserId);

    const updated = await save(tx, row, {
      ownerUserId: input.actor.userId,
      state: stateAfterAssignment(row.state),
    });
    await writeTrail(tx, { caseId: row.id, type: 'TAKEN', actorUserId: input.actor.userId });
    await writeCaseAudit(tx, input.actor, CASE_AUDIT.TAKEN, { caseId: row.id, caseNumber: row.caseNumber });
    await publish(tx, caseAssigned, {
      payload: { ...eventRef(updated), fromUserId: null, toUserId: input.actor.userId, reason: null },
      aggregateType: 'cases.case',
      aggregateId: row.id,
      actor: staffActorEvent(input.actor),
    });
    return toCaseView(updated);
  });
}

export async function reassignCase(
  db: Db,
  input: { actor: CaseActor; caseId: string; toUserId: string; reason: string },
): Promise<CaseView> {
  return db.transaction(async (tx) => {
    const row = await lockCase(tx, input.caseId);
    assertWorkable(row.state);
    if (row.ownerUserId === input.toUserId) return toCaseView(row);
    await assertCanManageCases(tx, input.toUserId);

    const updated = await save(tx, row, {
      ownerUserId: input.toUserId,
      state: stateAfterAssignment(row.state),
    });
    const metadata = { fromUserId: row.ownerUserId, toUserId: input.toUserId };
    await writeTrail(tx, {
      caseId: row.id,
      type: 'REASSIGNED',
      actorUserId: input.actor.userId,
      reason: input.reason,
      metadata,
    });
    await writeCaseAudit(tx, input.actor, CASE_AUDIT.REASSIGNED, {
      caseId: row.id,
      caseNumber: row.caseNumber,
      reason: input.reason,
      ...metadata,
    });
    await publish(tx, caseAssigned, {
      payload: {
        ...eventRef(updated),
        fromUserId: row.ownerUserId,
        toUserId: input.toUserId,
        reason: input.reason,
      },
      aggregateType: 'cases.case',
      aggregateId: row.id,
      actor: staffActorEvent(input.actor),
    });
    return toCaseView(updated);
  });
}

export async function escalateCase(
  db: Db,
  input: { actor: CaseActor; caseId: string; reason: string },
): Promise<CaseView> {
  return db.transaction(async (tx) => {
    const row = await lockCase(tx, input.caseId);
    if (row.state === 'ESCALATED') return toCaseView(row);
    const state = stateAfterEscalation(row.state);

    const updated = await save(tx, row, { state, escalatedAt: new Date() });
    await writeTrail(tx, {
      caseId: row.id,
      type: 'ESCALATED',
      actorUserId: input.actor.userId,
      reason: input.reason,
      metadata: { from: row.state },
    });
    await writeCaseAudit(tx, input.actor, CASE_AUDIT.ESCALATED, {
      caseId: row.id,
      caseNumber: row.caseNumber,
      reason: input.reason,
    });
    await publish(tx, caseEscalated, {
      payload: { ...eventRef(updated), reason: input.reason },
      aggregateType: 'cases.case',
      aggregateId: row.id,
      actor: staffActorEvent(input.actor),
    });
    return toCaseView(updated);
  });
}

export async function setCasePriority(
  db: Db,
  input: { actor: CaseActor; caseId: string; priority: CasePriority; reason: string },
): Promise<CaseView> {
  return db.transaction(async (tx) => {
    const row = await lockCase(tx, input.caseId);
    assertWorkable(row.state);
    if (row.priority === input.priority) return toCaseView(row);

    const updated = await save(tx, row, { priority: input.priority });
    const metadata = { from: row.priority, to: input.priority };
    await writeTrail(tx, {
      caseId: row.id,
      type: 'PRIORITY_CHANGED',
      actorUserId: input.actor.userId,
      reason: input.reason,
      metadata,
    });
    await writeCaseAudit(tx, input.actor, CASE_AUDIT.PRIORITY_CHANGED, {
      caseId: row.id,
      caseNumber: row.caseNumber,
      reason: input.reason,
      ...metadata,
    });
    return toCaseView(updated);
  });
}

export async function requestEvidence(
  db: Db,
  input: {
    actor: CaseActor;
    caseId: string;
    description: string;
    fromUserId?: string | undefined;
    dueAt?: Date | undefined;
  },
): Promise<{ case: CaseView; request: EvidenceRequestView }> {
  return db.transaction(async (tx) => {
    const row = await lockCase(tx, input.caseId);
    assertWorkable(row.state);

    const [request] = await tx
      .insert(caseEvidenceRequests)
      .values({
        caseId: row.id,
        description: input.description,
        fromUserId: input.fromUserId ?? null,
        requestedByUserId: input.actor.userId,
        dueAt: input.dueAt ?? null,
      })
      .returning();
    if (!request) throw new Error('cases: the evidence request insert returned no row');
    const updated = await save(tx, row, { state: stateAfterEvidenceRequested(row.state) });

    const metadata = { requestId: request.id, fromUserId: request.fromUserId, dueAt: input.dueAt ?? null };
    await writeTrail(tx, {
      caseId: row.id,
      type: 'EVIDENCE_REQUESTED',
      actorUserId: input.actor.userId,
      metadata,
    });
    await writeCaseAudit(tx, input.actor, CASE_AUDIT.EVIDENCE_REQUESTED, {
      caseId: row.id,
      caseNumber: row.caseNumber,
      ...metadata,
    });
    return { case: toCaseView(updated), request: toEvidenceView(request) };
  });
}

/**
 * Resolves an evidence request. Staff call it through the route; an owning module calls it with
 * `actor: null` when the file arrives through its own upload flow.
 */
export async function resolveEvidenceRequest(
  db: Db,
  input: {
    actor: CaseActor | null;
    caseId: string;
    requestId: string;
    status: Exclude<EvidenceRequestStatus, 'OPEN'>;
    note?: string | undefined;
  },
): Promise<{ case: CaseView; request: EvidenceRequestView }> {
  return db.transaction(async (tx) => {
    const row = await lockCase(tx, input.caseId);
    const [request] = await tx
      .select()
      .from(caseEvidenceRequests)
      .where(and(eq(caseEvidenceRequests.id, input.requestId), eq(caseEvidenceRequests.caseId, row.id)));
    if (!request) throw evidenceRequestNotFound();
    if (request.status !== 'OPEN') throw evidenceRequestResolved();

    const [resolved] = await tx
      .update(caseEvidenceRequests)
      .set({
        status: input.status,
        resolvedAt: sql`now()`,
        resolvedByUserId: input.actor?.userId ?? null,
        resolutionNote: input.note ?? null,
      })
      .where(eq(caseEvidenceRequests.id, request.id))
      .returning();
    if (!resolved) throw evidenceRequestNotFound();
    const [open] = await tx
      .select({ n: count() })
      .from(caseEvidenceRequests)
      .where(and(eq(caseEvidenceRequests.caseId, row.id), eq(caseEvidenceRequests.status, 'OPEN')));
    const updated = await save(tx, row, { state: stateAfterEvidenceResolved(row.state, open?.n ?? 0) });

    const metadata = { requestId: request.id, status: input.status };
    await writeTrail(tx, {
      caseId: row.id,
      type: 'EVIDENCE_RESOLVED',
      actorUserId: input.actor?.userId ?? null,
      reason: input.note ?? null,
      metadata,
    });
    if (input.actor) {
      await writeCaseAudit(tx, input.actor, CASE_AUDIT.EVIDENCE_RESOLVED, {
        caseId: row.id,
        caseNumber: row.caseNumber,
        ...metadata,
      });
    }
    return { case: toCaseView(updated), request: toEvidenceView(resolved) };
  });
}

export interface DecideInput {
  actor: CaseActor;
  caseId: string;
  outcome: string;
  reason: string;
  policyCitation: string;
}

/**
 * The only function in this module that writes a decision, and it takes a signed-in staff member's
 * identity, a reason and a policy citation: there is nowhere to pass an advisory in. It writes the
 * decision (carrying its citation), the trust trail, the admin action log and the outbox event, in
 * one transaction.
 */
export async function decideCase(
  db: Db,
  input: DecideInput,
): Promise<{ case: CaseView; decision: DecisionView }> {
  return db.transaction(async (tx) => {
    const row = await lockCase(tx, input.caseId);
    assertWorkable(row.state);
    if (row.ownerUserId !== input.actor.userId) throw notCaseOwner();

    const [decision] = await tx
      .insert(caseDecisions)
      .values({
        caseId: row.id,
        decidedByUserId: input.actor.userId,
        outcome: input.outcome,
        reason: input.reason,
        policyCitation: input.policyCitation,
      })
      .returning();
    if (!decision) throw new Error('cases: the decision insert returned no row');
    const updated = await save(tx, row, { state: 'DECIDED', decidedAt: new Date() });

    const detail = {
      decisionId: decision.id,
      outcome: input.outcome,
      policyCitation: input.policyCitation,
    };
    await writeTrail(tx, {
      caseId: row.id,
      type: 'DECISION_RECORDED',
      actorUserId: input.actor.userId,
      reason: input.reason,
      metadata: detail,
    });
    await writeCaseAudit(tx, input.actor, CASE_AUDIT.DECIDED, {
      caseId: row.id,
      caseNumber: row.caseNumber,
      type: row.type,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      reason: input.reason,
      ...detail,
    });
    await publish(tx, caseDecided, {
      payload: { ...eventRef(updated), ...detail, decidedByUserId: input.actor.userId },
      aggregateType: 'cases.case',
      aggregateId: row.id,
      actor: staffActorEvent(input.actor),
    });
    return { case: toCaseView(updated), decision: toDecisionView(decision) };
  });
}
