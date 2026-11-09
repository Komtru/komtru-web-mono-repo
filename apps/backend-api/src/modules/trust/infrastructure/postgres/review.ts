// What the persistence layer does for T-052 inside a transaction another function already holds:
// open the review case when a request is parked for a person, write the duplicate flag beside it, and
// publish a rejection together with the "two in 30 days" hand-off to support.
//
// Both write in the SAME transaction as the state change they describe (design §4.5), so a request
// can never sit in MANUAL_REVIEW without a case a reviewer can see, and a rollback leaves neither.
import { and, eq, gte, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { registerCase } from '../../../cases/index.js';
import { publish, type PublishInput, type Tx } from '../../../../platform/events/publish.js';
import { verificationRejected, verificationRepeatedRejection } from '../../domain/events.js';
import {
  REPEATED_REJECTION_WINDOW_DAYS,
  REVIEW_SUBJECT_TYPE,
  caseTitleFor,
  caseTypeFor,
  isRepeatedRejection,
  reviewFacts,
} from '../../domain/review.js';
import { duplicateIdentityFlags } from './schema/duplicate-flags.js';
import type { VerificationType } from './schema/enums.js';
import { verificationRequests } from './schema/requests.js';

export interface ReviewSubject {
  id: string;
  userId: string;
  verificationType: VerificationType;
  attemptCount: number;
}

export interface DuplicateClaim {
  identifierHash: Buffer;
  /** Null when the owner row vanished between the unique violation and the read: a case, but no flag. */
  firstUserId: string | null;
}

/** `DUPLICATE_IDENTITY` is the only reason that changes the case's priority and facts. */
export const DUPLICATE_REASON = 'DUPLICATE_IDENTITY';
export const MANUAL_REASON = 'NEEDS_HUMAN_REVIEW';

/**
 * Registers the case for a request that has just been parked in MANUAL_REVIEW and, for a duplicate,
 * writes the flag. Idempotent on both: `registerCase` is keyed on (type, subject) and the flag on
 * `request_id`, so a redelivered job writes nothing twice.
 */
export async function parkForReview(
  tx: Tx,
  request: ReviewSubject,
  duplicate?: DuplicateClaim,
): Promise<void> {
  const reason = duplicate ? DUPLICATE_REASON : MANUAL_REASON;
  await registerCase(tx, {
    type: caseTypeFor(request.verificationType),
    subjectType: REVIEW_SUBJECT_TYPE,
    subjectId: request.id,
    title: caseTitleFor(request.verificationType, reason),
    priority: duplicate ? 'HIGH' : 'NORMAL',
    facts: reviewFacts({
      verificationType: request.verificationType,
      reason,
      attemptCount: request.attemptCount,
    }),
  });

  if (!duplicate?.firstUserId) return;
  await tx
    .insert(duplicateIdentityFlags)
    .values({
      identifierType: request.verificationType,
      identifierHash: duplicate.identifierHash,
      firstUserId: duplicate.firstUserId,
      conflictingUserId: request.userId,
      requestId: request.id,
    })
    .onConflictDoNothing({ target: duplicateIdentityFlags.requestId });
}

type RejectedOptions = PublishInput<z.input<typeof verificationRejected.payload>>;

/**
 * Publishes `trust.verification.rejected` and, when that rejection is the second REJECTED request
 * the user has had inside 30 days, `trust.verification.repeated_rejection` for T-100 to turn into a
 * support ticket (M6 §9).
 *
 * Counts REJECTED requests only, across every type: an EXPIRED request is the provider's failure, not
 * the user's, and the sweep also publishes `rejected` through here. It asks about THIS request's own
 * status first for that reason.
 */
export async function publishRejected(tx: Tx, options: RejectedOptions): Promise<void> {
  await publish(tx, verificationRejected, options);

  const { requestId, userId, type } = options.payload;
  const [own] = await tx
    .select({ status: verificationRequests.status })
    .from(verificationRequests)
    .where(eq(verificationRequests.id, requestId));
  if (own?.status !== 'REJECTED') return;

  // One user's rejections are counted one transaction at a time. Without this two concurrent
  // rejections each see only their own row (the other is uncommitted) and count 1, so neither fires;
  // with it the second counts after the first has committed and sees 2. The lock is held to commit.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`trust:rejections:${userId}`}))`);

  // The OTHER rejections inside the window, then this one added explicitly: this request's own
  // `decided_at` is not relied on to land inside (or outside) the window.
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(verificationRequests)
    .where(
      and(
        eq(verificationRequests.userId, userId),
        eq(verificationRequests.status, 'REJECTED'),
        ne(verificationRequests.id, requestId),
        gte(
          verificationRequests.decidedAt,
          sql`now() - make_interval(days => ${REPEATED_REJECTION_WINDOW_DAYS})`,
        ),
      ),
    );
  const count = (row?.n ?? 0) + 1;
  if (!isRepeatedRejection(count)) return;

  await publish(tx, verificationRepeatedRejection, {
    payload: {
      userId,
      requestId,
      type,
      rejectionCount: count,
      windowDays: REPEATED_REJECTION_WINDOW_DAYS,
    },
    aggregateType: 'user',
    aggregateId: userId,
  });
}
