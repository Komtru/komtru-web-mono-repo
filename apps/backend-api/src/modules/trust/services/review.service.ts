// The KYC/KYB review queue (M6 §6.8, §11) and the verification override (§10).
//
// There is no `kyc_review_queue` table. A request parked in MANUAL_REVIEW registers a case in the
// universal index (T-107, `IDENTITY` or `KYB`) in the same transaction as the park, and this file is
// the trust-side view over those cases: list them, show one with its advisory, assign it, decide it.
// The decision is recorded as a case decision (with its policy citation) and then acted on here, so
// the case model stays an index and trust stays the owner of the verification record.
import { and, asc, count, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { publish } from '../../../platform/events/publish.js';
import {
  adviseOnCase,
  caseCode,
  caseIndex,
  closeCaseForSubject,
  decideCase,
  FINISHED_STATES,
  takeCase,
  type Advisory,
  type CaseActor,
} from '../../cases/index.js';
import { consumeApproval, requestApproval, type StaffActor } from '../../identity/index.js';
import { levelNumber } from '../domain/levels.js';
import type { RejectionCode } from '../domain/rejection.js';
import { verificationReviewDecided } from '../domain/events.js';
import { DEFAULT_REVIEW_CITATION, REVIEW_SUBJECT_TYPE, assertOverrideAllowed } from '../domain/review.js';
import { bindStore } from '../infrastructure/postgres/bind-store.js';
import { duplicateIdentityFlags } from '../infrastructure/postgres/schema/duplicate-flags.js';
import { verificationRequests } from '../infrastructure/postgres/schema/requests.js';
import { approveRequest, lockReviewRequest, rejectRequest } from './review-effects.js';

const KYC_CASE_TYPES = ['IDENTITY', 'KYB'] as const;

export interface KycQueueItem {
  caseId: string;
  caseNumber: string;
  caseType: string;
  state: string;
  priority: string;
  slaDueAt: Date;
  ownerUserId: string | null;
  requestId: string;
  userId: string;
  verificationType: string;
  submittedAt: Date;
  duplicateFlagId: string | null;
  duplicateFlagStatus: string | null;
}

const itemColumns = {
  caseId: caseIndex.id,
  caseNumber: caseIndex.caseNumber,
  caseType: caseIndex.type,
  state: caseIndex.state,
  priority: caseIndex.priority,
  slaDueAt: caseIndex.slaDueAt,
  ownerUserId: caseIndex.ownerUserId,
  requestId: verificationRequests.id,
  userId: verificationRequests.userId,
  verificationType: verificationRequests.verificationType,
  submittedAt: verificationRequests.submittedAt,
  duplicateFlagId: duplicateIdentityFlags.id,
  duplicateFlagStatus: duplicateIdentityFlags.status,
};

const toItem = (row: { caseNumber: number; [key: string]: unknown }): KycQueueItem => ({
  ...(row as unknown as KycQueueItem),
  caseNumber: caseCode(row.caseNumber),
});

const itemQuery = (db: Db) =>
  db
    .select(itemColumns)
    .from(caseIndex)
    .innerJoin(
      verificationRequests,
      and(
        eq(caseIndex.subjectType, REVIEW_SUBJECT_TYPE),
        sql`${caseIndex.subjectId} = ${verificationRequests.id}::text`,
      ),
    )
    .leftJoin(duplicateIdentityFlags, eq(duplicateIdentityFlags.requestId, verificationRequests.id));

export async function listKycQueue(
  db: Db,
  input: {
    caseType?: 'IDENTITY' | 'KYB' | undefined;
    includeFinished?: boolean | undefined;
    page: number;
    limit: number;
  },
): Promise<{ items: KycQueueItem[]; page: number; limit: number; total: number }> {
  const where = and(
    input.caseType ? eq(caseIndex.type, input.caseType) : inArray(caseIndex.type, [...KYC_CASE_TYPES]),
    input.includeFinished ? undefined : notInArray(caseIndex.state, [...FINISHED_STATES]),
  );
  const [rows, total] = await Promise.all([
    itemQuery(db)
      .where(where)
      .orderBy(asc(caseIndex.slaDueAt), desc(caseIndex.caseNumber))
      .limit(input.limit)
      .offset((input.page - 1) * input.limit),
    db.select({ n: count() }).from(caseIndex).where(where),
  ]);
  return { items: rows.map(toItem), page: input.page, limit: input.limit, total: total[0]?.n ?? 0 };
}

export interface KycQueueDetail extends KycQueueItem {
  advisory: Advisory;
}

export async function getKycQueueItem(db: Db, requestId: string): Promise<KycQueueDetail> {
  const [row] = await itemQuery(db).where(eq(verificationRequests.id, requestId));
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'No such review item');
  // The advisory is served by the cases module on a read-only path: a suggestion, labelled, with
  // nothing in it that could be stored as a decision.
  return { ...toItem(row), advisory: await adviseOnCase(db, row.caseId) };
}

async function caseOf(db: Db, requestId: string): Promise<{ id: string; type: string }> {
  const [row] = await db
    .select({ id: caseIndex.id, type: caseIndex.type })
    .from(caseIndex)
    .where(and(eq(caseIndex.subjectType, REVIEW_SUBJECT_TYPE), eq(caseIndex.subjectId, requestId)));
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'No such review item');
  return row;
}

/** Takes the case: the analyst who assigns it to themselves is the only one who can decide it. */
export async function assignReview(db: Db, input: { actor: CaseActor; requestId: string }) {
  const found = await caseOf(db, input.requestId);
  return takeCase(db, { actor: input.actor, caseId: found.id });
}

export interface DecideReviewInput {
  actor: CaseActor;
  requestId: string;
  outcome: 'APPROVE' | 'REJECT';
  reason: string;
  policyCitation?: string | undefined;
  /** What the user is told on a rejection. Defaults to `REVIEW_DECLINED`. */
  rejectionCode?: RejectionCode | undefined;
}

export async function decideReview(
  db: Db,
  input: DecideReviewInput,
): Promise<{ requestId: string; status: string }> {
  return db.transaction(async (tx) => {
    const request = await lockReviewRequest(tx, input.requestId);

    // A flagged request is decided through its flag (M6 §7), which has its own rules and, for a
    // clearance, a second approver. Letting the queue decide it would be a way around both.
    const [flag] = await tx
      .select({ id: duplicateIdentityFlags.id, status: duplicateIdentityFlags.status })
      .from(duplicateIdentityFlags)
      .where(eq(duplicateIdentityFlags.requestId, request.id));
    if (flag && (flag.status === 'OPEN' || flag.status === 'ESCALATED')) {
      throw new ApiError(
        409,
        'CONFLICT',
        'This request is held by a duplicate-identity flag',
        'Resolve the flag instead of deciding the request.',
      );
    }

    const found = await caseOf(tx, request.id);
    await decideCase(tx, {
      actor: input.actor,
      caseId: found.id,
      outcome: input.outcome === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      reason: input.reason,
      policyCitation: input.policyCitation ?? DEFAULT_REVIEW_CITATION,
    });

    if (input.outcome === 'APPROVE') await approveRequest(tx, request, input.actor.userId);
    else await rejectRequest(tx, request, input.rejectionCode ?? 'REVIEW_DECLINED');

    await closeCaseForSubject(
      tx,
      { type: found.type as 'IDENTITY' | 'KYB', subjectType: REVIEW_SUBJECT_TYPE, subjectId: request.id },
      input.outcome === 'APPROVE' ? 'APPROVED' : 'REJECTED',
    );
    await publish(tx, verificationReviewDecided, {
      payload: {
        requestId: request.id,
        userId: request.userId,
        type: request.verificationType,
        outcome: input.outcome === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        caseId: found.id,
        decidedByUserId: input.actor.userId,
      },
      aggregateType: 'verification_request',
      aggregateId: request.id,
      actor: { type: 'STAFF', id: input.actor.userId },
    });
    return { requestId: request.id, status: input.outcome === 'APPROVE' ? 'APPROVED' : 'REJECTED' };
  });
}

// --- verification.override (M6 §10): dual approval or nothing --------------------------------------

export type OverrideRequest =
  | { kind: 'LEVEL'; userId: string; direction: 'GRANT' | 'REVOKE'; toLevel: number; reason: string }
  | { kind: 'CLEAR_DUPLICATE'; flagId: string; reason: string };

/** The payload a second holder signs, and the one `consumeApproval` compares at execution. */
export const overridePayload = (input: OverrideRequest): Record<string, unknown> =>
  input.kind === 'LEVEL'
    ? { kind: 'LEVEL', direction: input.direction, toLevel: input.toLevel }
    : { kind: 'CLEAR_DUPLICATE', flagId: input.flagId };

/**
 * Step one: the requester asks. Nothing changes. The approval row is T-037's `admin_action_approvals`,
 * so a different holder of `verification.override` approves it through `/admin/approvals/:id/approve`
 * (the same dual-approval path as every other two-step action; M6 does not invent a parallel one).
 */
export async function requestOverride(db: Db, input: { actor: StaffActor } & OverrideRequest) {
  let subjectUserId: string;
  if (input.kind === 'LEVEL') {
    const subject = await bindStore(db).findSubject(input.userId);
    if (!subject) throw new ApiError(404, 'NOT_FOUND', 'No such user');
    assertOverrideAllowed({
      direction: input.direction,
      toLevel: input.toLevel,
      currentLevel: levelNumber(subject.verificationLevel),
    });
    subjectUserId = input.userId;
  } else {
    const [flag] = await db
      .select({ conflictingUserId: duplicateIdentityFlags.conflictingUserId })
      .from(duplicateIdentityFlags)
      .where(eq(duplicateIdentityFlags.id, input.flagId));
    if (!flag) throw new ApiError(404, 'NOT_FOUND', 'No such duplicate flag');
    subjectUserId = flag.conflictingUserId;
  }
  return requestApproval(db, {
    actor: input.actor,
    action: 'VERIFICATION_OVERRIDE',
    subjectUserId,
    reason: input.reason,
    payload: overridePayload(input),
  });
}

/**
 * Step two: the requester carries out what the other holder approved. `consumeApproval` spends the
 * approval exactly once and refuses a payload that differs from the one signed, a different person
 * from the requester, or a requester who has since lost the permission.
 */
export async function executeLevelOverride(
  db: Db,
  input: {
    actor: StaffActor;
    approvalId: string;
    userId: string;
    direction: 'GRANT' | 'REVOKE';
    toLevel: number;
    reason: string;
  },
): Promise<{ from: number; to: number }> {
  return db.transaction(async (tx) => {
    const store = bindStore(tx);
    const subject = await store.findSubject(input.userId);
    if (!subject) throw new ApiError(404, 'NOT_FOUND', 'No such user');
    assertOverrideAllowed({
      direction: input.direction,
      toLevel: input.toLevel,
      currentLevel: levelNumber(subject.verificationLevel),
    });

    await consumeApproval(tx, {
      approvalId: input.approvalId,
      action: 'VERIFICATION_OVERRIDE',
      subjectUserId: input.userId,
      expectedPayload: overridePayload({ kind: 'LEVEL', ...input }),
      consumedBy: input.actor.userId,
    });

    const change = {
      userId: input.userId,
      toLevel: input.toLevel,
      reason: input.reason,
      actorType: 'KYC_ANALYST' as const,
      actorId: input.actor.userId,
    };
    const outcome =
      input.direction === 'GRANT'
        ? await store.grantLevel({ ...change, provider: 'MANUAL' })
        : await store.revokeLevel(change);
    if (!outcome.changed) throw new ApiError(409, 'CONFLICT', 'The user’s level changed in the meantime');
    return { from: outcome.from, to: outcome.to };
  });
}
