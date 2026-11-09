// Duplicate-identity flags (M6 §6.7, §7): list them and resolve them.
//
// The one rule this file exists to keep is §7's: NOTHING here is automatic. A flag is written when a
// job parks a request, and from then on only a person moves it. Confirming a duplicate rejects the
// second claim; clearing a false positive hands the identifier from the first account to the second
// and so needs a second approver; escalating records that a senior reviewer should look.
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { publish } from '../../../platform/events/publish.js';
import {
  caseIndex,
  closeCaseForSubject,
  decideCase,
  escalateCase,
  type CaseActor,
} from '../../cases/index.js';
import { consumeApproval, type StaffActor } from '../../identity/index.js';
import { verificationDuplicateFlagResolved } from '../domain/events.js';
import { DUPLICATE_CITATION, REVIEW_SUBJECT_TYPE } from '../domain/review.js';
import {
  duplicateIdentityFlags,
  type DuplicateIdentityFlag,
} from '../infrastructure/postgres/schema/duplicate-flags.js';
import type { DuplicateFlagStatus } from '../infrastructure/postgres/schema/enums.js';
import { approveRequest, lockReviewRequest, rejectRequest, releaseFirstOwner } from './review-effects.js';

export interface DuplicateFlagView {
  id: string;
  identifierType: string;
  firstUserId: string;
  conflictingUserId: string;
  requestId: string;
  status: string;
  detectedAt: Date;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  resolutionNotes: string | null;
}

/** The hash is deliberately left off: a reviewer needs the two accounts, not a linkable digest. */
const view = (row: DuplicateIdentityFlag): DuplicateFlagView => ({
  id: row.id,
  identifierType: row.identifierType,
  firstUserId: row.firstUserId,
  conflictingUserId: row.conflictingUserId,
  requestId: row.requestId,
  status: row.status,
  detectedAt: row.detectedAt,
  reviewedBy: row.reviewedBy,
  reviewedAt: row.reviewedAt,
  resolutionNotes: row.resolutionNotes,
});

export async function listDuplicateFlags(
  db: Db,
  input: { status?: DuplicateFlagStatus | undefined; page: number; limit: number },
): Promise<{ items: DuplicateFlagView[]; page: number; limit: number; total: number }> {
  const where = input.status ? eq(duplicateIdentityFlags.status, input.status) : undefined;
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(duplicateIdentityFlags)
      .where(where)
      .orderBy(desc(duplicateIdentityFlags.detectedAt), desc(duplicateIdentityFlags.id))
      .limit(input.limit)
      .offset((input.page - 1) * input.limit),
    db.select({ n: count() }).from(duplicateIdentityFlags).where(where),
  ]);
  return { items: rows.map(view), page: input.page, limit: input.limit, total: total[0]?.n ?? 0 };
}

export type FlagResolution = Exclude<DuplicateFlagStatus, 'OPEN'>;

export interface ResolveFlagInput {
  actor: StaffActor & CaseActor;
  flagId: string;
  resolution: FlagResolution;
  notes: string;
  /** Required for CLEARED_FALSE_POSITIVE: the approved `VERIFICATION_OVERRIDE` (dual approval). */
  approvalId?: string | undefined;
  policyCitation?: string | undefined;
}

export async function resolveDuplicateFlag(db: Db, input: ResolveFlagInput): Promise<DuplicateFlagView> {
  if (input.resolution === 'CLEARED_FALSE_POSITIVE' && !input.approvalId) {
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'Clearing a duplicate needs a second approver',
      'Request a clearance with POST /admin/kyc/overrides, have another holder approve it, then pass its approvalId.',
      [{ path: 'approvalId', message: 'Required to clear a duplicate' }],
    );
  }

  return db.transaction(async (tx) => {
    const [flag] = await tx
      .select()
      .from(duplicateIdentityFlags)
      .where(eq(duplicateIdentityFlags.id, input.flagId))
      .for('update');
    if (!flag) throw new ApiError(404, 'NOT_FOUND', 'No such duplicate flag');
    if (flag.status === 'CONFIRMED_DUPLICATE' || flag.status === 'CLEARED_FALSE_POSITIVE') {
      throw new ApiError(409, 'CONFLICT', 'That flag is already resolved');
    }

    const request = await lockReviewRequest(tx, flag.requestId);
    const [found] = await tx
      .select({ id: caseIndex.id, type: caseIndex.type })
      .from(caseIndex)
      .where(and(eq(caseIndex.subjectType, REVIEW_SUBJECT_TYPE), eq(caseIndex.subjectId, request.id)));
    if (!found) throw new ApiError(409, 'CONFLICT', 'That flag has no review case');

    let status: DuplicateFlagStatus;
    if (input.resolution === 'ESCALATED') {
      if (flag.status === 'ESCALATED') throw new ApiError(409, 'CONFLICT', 'That flag is already escalated');
      await escalateCase(tx, { actor: input.actor, caseId: found.id, reason: input.notes });
      status = 'ESCALATED';
    } else {
      // Recorded as the case's decision first: it checks the reviewer took the case, and writes the
      // policy citation and the audit row that make the outcome explainable afterwards.
      await decideCase(tx, {
        actor: input.actor,
        caseId: found.id,
        outcome: input.resolution === 'CONFIRMED_DUPLICATE' ? 'DUPLICATE_CONFIRMED' : 'DUPLICATE_CLEARED',
        reason: input.notes,
        policyCitation: input.policyCitation ?? DUPLICATE_CITATION,
      });

      if (input.resolution === 'CONFIRMED_DUPLICATE') {
        await rejectRequest(tx, request, 'DUPLICATE_IDENTITY');
      } else {
        await consumeApproval(tx, {
          approvalId: input.approvalId ?? '',
          action: 'VERIFICATION_OVERRIDE',
          subjectUserId: flag.conflictingUserId,
          expectedPayload: { kind: 'CLEAR_DUPLICATE', flagId: flag.id },
          consumedBy: input.actor.userId,
        });
        await releaseFirstOwner(tx, {
          type: flag.identifierType as 'NIN' | 'BVN' | 'CAC',
          firstUserId: flag.firstUserId,
          identifierHash: flag.identifierHash,
          conflictingRequestId: request.id,
          actorUserId: input.actor.userId,
          reason: `Duplicate cleared as a false positive: ${input.notes}`,
        });
        await approveRequest(tx, request, input.actor.userId);
      }
      await closeCaseForSubject(
        tx,
        { type: found.type, subjectType: REVIEW_SUBJECT_TYPE, subjectId: request.id },
        input.resolution,
      );
      status = input.resolution;
    }

    const [updated] = await tx
      .update(duplicateIdentityFlags)
      .set({
        status,
        reviewedBy: input.actor.userId,
        reviewedAt: new Date(),
        resolutionNotes: input.notes,
      })
      .where(
        and(
          eq(duplicateIdentityFlags.id, flag.id),
          inArray(duplicateIdentityFlags.status, ['OPEN', 'ESCALATED']),
        ),
      )
      .returning();
    if (!updated) throw new ApiError(409, 'CONFLICT', 'That flag is already resolved');

    await publish(tx, verificationDuplicateFlagResolved, {
      payload: {
        flagId: flag.id,
        identifierType: flag.identifierType,
        status,
        firstUserId: flag.firstUserId,
        conflictingUserId: flag.conflictingUserId,
        resolvedByUserId: input.actor.userId,
      },
      aggregateType: 'verification_request',
      aggregateId: flag.requestId,
      actor: { type: 'STAFF', id: input.actor.userId },
    });
    return view(updated);
  });
}
