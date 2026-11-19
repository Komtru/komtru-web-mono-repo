// The one way a dispute's status changes. Every mutating service goes through `moveCase`, so the
// guard, the log row and the case-index sync cannot be forgotten in one place and remembered in
// another — which is the failure mode a state machine written down twice always eventually has.
//
// The guard is a guarded UPDATE (`WHERE id = $1 AND status IN (...)`) rather than a read followed
// by a write: the database decides the race, so two reviewers deciding the same case in the same
// instant produce one decision and one 409, not two decisions.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { syncCaseFacts } from '../../cases/index.js';
import { writeAudit } from '../../identity/index.js';
import type { Tx } from '../../../platform/events/publish.js';
import { invalidTransition } from '../domain/errors.js';
import { canTransition } from '../domain/stateMachine.js';
import type { DisputeAction, DisputeActorType, DisputeStatus } from '../domain/types.js';
import { disputeCases } from '../infrastructure/postgres/schema/disputes.js';
import { disputeStatusChanges } from '../infrastructure/postgres/schema/statusChanges.js';
import type { DisputeRow } from './views.js';

/** Who is acting, carried from the HTTP layer so the audit row can say where it came from. */
export interface DisputeActor {
  userId: string | null;
  actorType: DisputeActorType;
  sessionId?: string | undefined;
  ip?: string | null;
  userAgent?: string | null;
}

export const SYSTEM_ACTOR: DisputeActor = { userId: null, actorType: 'SYSTEM' };

export const DISPUTE_AUDIT = {
  OPENED: 'DISPUTE_OPENED',
  WITHDRAWN: 'DISPUTE_WITHDRAWN',
  EVIDENCE_SUBMITTED: 'DISPUTE_EVIDENCE_SUBMITTED',
  EVIDENCE_REOPENED: 'DISPUTE_EVIDENCE_REOPENED',
  ASSIGNED: 'DISPUTE_ASSIGNED',
  DECIDED: 'DISPUTE_DECIDED',
  MEDIATION_PROPOSED: 'DISPUTE_MEDIATION_PROPOSED',
  MEDIATION_AGREED: 'DISPUTE_MEDIATION_AGREED',
  APPEALED: 'DISPUTE_APPEALED',
  APPEAL_DECIDED: 'DISPUTE_APPEAL_DECIDED',
} as const;

export const writeDisputeAudit = (
  tx: Tx,
  actor: DisputeActor,
  action: string,
  metadata: Record<string, unknown>,
): Promise<unknown> =>
  writeAudit(tx, {
    action,
    outcome: 'SUCCESS',
    actorType: actor.actorType === 'SYSTEM' ? 'SYSTEM' : 'USER',
    actorUserId: actor.userId,
    sessionId: actor.sessionId ?? null,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
    metadata,
  });

/** Locks the case for the rest of the transaction. Returns null when there is no such dispute. */
export async function lockDispute(tx: Tx, disputeId: string): Promise<DisputeRow | null> {
  const [row] = await tx.select().from(disputeCases).where(eq(disputeCases.id, disputeId)).for('update');
  return row ?? null;
}

export interface MoveInput {
  action: DisputeAction;
  to: DisputeStatus;
  actor: DisputeActor;
  reason?: string | null;
  /** Columns the transition also sets — `decidedAt`, `appealDeadlineAt`, a reviewer id. */
  set?: Partial<typeof disputeCases.$inferInsert>;
}

/**
 * Moves `row` to `input.to`, or throws 409. The caller has already locked the row; the guarded
 * UPDATE is belt and braces for the paths that have not (a sweep updating in bulk).
 *
 * The returned row is the updated one. A status-change row is written for every move, which is
 * what Customer-8's timeline and the reviewer's trail are drawn from.
 */
export async function moveCase(tx: Tx, row: DisputeRow, input: MoveInput): Promise<DisputeRow> {
  const allowed = canTransition(input.action, row.status);
  if (!allowed.includes(input.to)) throw invalidTransition(input.action, row.status);

  const sources = [...new Set([row.status])];
  const [updated] = await tx
    .update(disputeCases)
    .set({ ...input.set, status: input.to, updatedAt: sql`now()` })
    .where(and(eq(disputeCases.id, row.id), inArray(disputeCases.status, sources)))
    .returning();

  // The guard lost: someone else moved the case between the lock and here. 409, never a silent
  // no-op — a withdrawal that quietly did nothing is the worst possible answer on a money screen.
  if (!updated) throw invalidTransition(input.action, row.status);

  await tx.insert(disputeStatusChanges).values({
    disputeId: row.id,
    fromStatus: row.status,
    toStatus: input.to,
    action: input.action,
    actorType: input.actor.actorType,
    actorId: input.actor.userId,
    reason: input.reason ?? null,
  });

  // Keep the universal case index's advisory inputs current (T-107). Facts only — small scalars
  // the console reads — never a copy of the dispute itself.
  await syncCaseFacts(
    tx,
    { type: 'DISPUTE', subjectType: 'dispute', subjectId: row.id },
    { status: input.to, lastAction: input.action },
  );

  return updated;
}
