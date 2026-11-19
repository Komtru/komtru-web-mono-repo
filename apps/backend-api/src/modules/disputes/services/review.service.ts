// Assignment (M3 D3) and the decision (M3 D4) — the reviewer's half, and the one F-035's
// DecisionPanel will call.
import { eq, sql } from 'drizzle-orm';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { disputeAssigned, disputeResolved } from '../domain/events.js';
import { assertDecisionSums, type DecisionAmounts } from '../domain/decision.js';
import { disputeNotFound, reviewerRefused } from '../domain/errors.js';
import { reviewerEligibility } from '../domain/assignment.js';
import type { DecisionOutcome } from '../domain/types.js';
import { appealDeadline } from '../domain/windows.js';
import { disputeDecisionLog } from '../infrastructure/postgres/schema/decisions.js';
import { disputeCases } from '../infrastructure/postgres/schema/disputes.js';
import type { DisputePorts } from './ports.js';
import {
  DISPUTE_AUDIT,
  asParty,
  lockDispute,
  moveCase,
  writeDisputeAudit,
  type RequestActor,
} from './transition.js';
import { toDecisionView, toDisputeView, type DecisionView, type DisputeView } from './views.js';

export interface AssignInput {
  disputeId: string;
  reviewerId: string;
  actor: RequestActor;
}

/**
 * Put the case in front of a reviewer. M3 D3 says this exclusion is enforced at the assignment
 * layer rather than left to convention, which is exactly what this is: the rule is a pure
 * function, the facts come from a port, and no route can assign around it.
 *
 * Assigning does not move the case: a dispute reaches `UNDER_REVIEW` because its evidence window
 * closed, and naming a reviewer is a separate fact about who is working it. Keeping the two apart
 * means an unassigned case still shows in the queue as work that exists.
 */
export async function assignReviewer(ports: DisputePorts, tx: Tx, input: AssignInput): Promise<DisputeView> {
  const row = await lockDispute(tx, input.disputeId);
  if (!row) throw disputeNotFound();

  const isAppeal = row.status === 'APPEALED' || row.status === 'APPEAL_UNDER_REVIEW';
  const related = await ports.relatedUsers(tx, {
    buyerUserId: row.buyerUserId,
    sellerUserId: row.sellerUserId,
  });

  const eligible = reviewerEligibility({
    reviewerId: input.reviewerId,
    buyerUserId: row.buyerUserId,
    sellerUserId: row.sellerUserId,
    originalReviewerId: row.assignedReviewerId,
    isAppeal,
    sharedDeviceUserIds: related.sharedDeviceUserIds,
    sharedPayoutUserIds: related.sharedPayoutUserIds,
  });
  if (!eligible.allowed) throw reviewerRefused(eligible.reason);

  const now = ports.now();
  // An appeal moves APPEALED → APPEAL_UNDER_REVIEW when a lead picks it up; an original review is
  // already UNDER_REVIEW and only gains a name.
  const updated =
    row.status === 'APPEALED'
      ? await moveCase(tx, row, {
          action: 'ASSIGN_APPEAL',
          to: 'APPEAL_UNDER_REVIEW',
          actor: asParty(input.actor, row),
          set: { assignedAppealLeadId: input.reviewerId },
        })
      : await updateAssignment(tx, row.id, isAppeal ? 'appeal' : 'review', input.reviewerId);

  await writeDisputeAudit(tx, asParty(input.actor, row), DISPUTE_AUDIT.ASSIGNED, {
    disputeId: row.id,
    reviewerId: input.reviewerId,
    isAppeal,
  });

  await publish(tx, disputeAssigned, {
    payload: {
      disputeId: row.id,
      disputeNumber: row.disputeNumber,
      tradeId: row.tradeId,
      reviewerId: input.reviewerId,
      isAppeal,
    },
    aggregateType: 'disputes.dispute',
    aggregateId: row.id,
  });

  return toDisputeView(updated, now);
}

/** Naming a reviewer without moving the case: see `assignReviewer`'s note on why those differ. */
async function updateAssignment(tx: Tx, disputeId: string, which: 'review' | 'appeal', reviewerId: string) {
  const [updated] = await tx
    .update(disputeCases)
    .set({
      ...(which === 'review' ? { assignedReviewerId: reviewerId } : { assignedAppealLeadId: reviewerId }),
      updatedAt: sql`now()`,
    })
    .where(eq(disputeCases.id, disputeId))
    .returning();
  if (!updated) throw disputeNotFound();
  return updated;
}

export interface DecideInput {
  disputeId: string;
  reviewerId: string;
  outcome: DecisionOutcome;
  amounts: DecisionAmounts;
  rationale: string;
  actor: RequestActor;
}

export interface DecisionResult {
  dispute: DisputeView;
  decision: DecisionView;
}

/**
 * Record the decision. The amounts are checked here, by the database trigger on insert, and again
 * by the ledger when it executes — M3 D4's "two checks, not one", with a third for good measure.
 *
 * Nothing about the money moves in this transaction. The decision is an instruction; M8 executes
 * it on the strength of `disputes.dispute.resolved`, and M7 moves the trade. This module never
 * writes to `trades` or to the ledger, which is the whole of M3's boundary argument.
 */
export async function decideDispute(
  ports: DisputePorts,
  tx: Tx,
  input: DecideInput,
): Promise<DecisionResult> {
  const row = await lockDispute(tx, input.disputeId);
  if (!row) throw disputeNotFound();

  // D3 again at the point of decision, not only at assignment: a reviewer could have been
  // assigned before a conflict was known, and the decision is the moment that matters.
  const related = await ports.relatedUsers(tx, {
    buyerUserId: row.buyerUserId,
    sellerUserId: row.sellerUserId,
  });
  const eligible = reviewerEligibility({
    reviewerId: input.reviewerId,
    buyerUserId: row.buyerUserId,
    sellerUserId: row.sellerUserId,
    originalReviewerId: null,
    isAppeal: false,
    sharedDeviceUserIds: related.sharedDeviceUserIds,
    sharedPayoutUserIds: related.sharedPayoutUserIds,
  });
  if (!eligible.allowed) throw reviewerRefused(eligible.reason);

  assertDecisionSums(input.outcome, input.amounts, row.totalEscrowMinor);

  const now = ports.now();
  const [decision] = await tx
    .insert(disputeDecisionLog)
    .values({
      disputeId: row.id,
      decisionType: 'ORIGINAL',
      decidedByUserId: input.reviewerId,
      outcome: input.outcome,
      amountToBuyerMinor: input.amounts.toBuyerMinor,
      amountToSellerMinor: input.amounts.toSellerMinor,
      rationale: input.rationale.trim(),
    })
    .returning();
  if (!decision) throw new Error('disputes: the decision insert returned no row');

  const appealDays = await ports.appealWindowDays();
  const updated = await moveCase(tx, row, {
    action: 'DECIDE',
    to: 'DECIDED',
    actor: asParty(input.actor, row),
    reason: input.rationale,
    set: { decidedAt: now, appealDeadlineAt: appealDeadline(now, appealDays) },
  });

  await writeDisputeAudit(tx, asParty(input.actor, row), DISPUTE_AUDIT.DECIDED, {
    disputeId: row.id,
    decisionId: String(decision.id),
    outcome: input.outcome,
    amountToBuyerMinor: input.amounts.toBuyerMinor.toString(),
    amountToSellerMinor: input.amounts.toSellerMinor.toString(),
  });

  await publish(tx, disputeResolved, {
    payload: {
      disputeId: row.id,
      disputeNumber: row.disputeNumber,
      tradeId: row.tradeId,
      decisionId: String(decision.id),
      decisionType: 'ORIGINAL',
      outcome: input.outcome,
      totalEscrowMinor: row.totalEscrowMinor.toString(),
      amountToBuyerMinor: input.amounts.toBuyerMinor.toString(),
      amountToSellerMinor: input.amounts.toSellerMinor.toString(),
      decidedByUserId: input.reviewerId,
      rationale: decision.rationale,
      agreedNote: null,
      decidedAt: now.toISOString(),
    },
    aggregateType: 'disputes.dispute',
    aggregateId: row.id,
  });

  return { dispute: toDisputeView(updated, now), decision: toDecisionView(decision) };
}
