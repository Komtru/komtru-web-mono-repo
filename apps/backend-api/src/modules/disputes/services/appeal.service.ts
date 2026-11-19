// M3 D5: one appeal, filed by a party inside the window, decided by a DISPUTE_LEAD who is not the
// original reviewer. After the appeal the case is CLOSED and final; an unappealed decision closes
// by itself when its window lapses.
import { desc, eq } from 'drizzle-orm';
import { ApiError } from '../../../platform/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { assertDecisionSums, type DecisionAmounts } from '../domain/decision.js';
import { disputeAppealResolved, disputeAppealed, disputeClosed } from '../domain/events.js';
import { appealEligibility } from '../domain/appeal.js';
import { appealRefused, disputeNotFound, reviewerRefused } from '../domain/errors.js';
import { reviewerEligibility } from '../domain/assignment.js';
import type { AppealOutcome, DecisionOutcome } from '../domain/types.js';
import { disputeDecisionLog } from '../infrastructure/postgres/schema/decisions.js';
import type { DisputePorts } from './ports.js';
import { DISPUTE_AUDIT, lockDispute, moveCase, writeDisputeAudit, type DisputeActor } from './transition.js';
import { toDecisionView, toDisputeView, type DecisionView, type DisputeView } from './views.js';

export interface FileAppealInput {
  disputeId: string;
  userId: string;
  reason: string;
  actor: DisputeActor;
}

export async function fileAppeal(ports: DisputePorts, tx: Tx, input: FileAppealInput): Promise<DisputeView> {
  const row = await lockDispute(tx, input.disputeId);
  if (!row) throw disputeNotFound();

  const now = ports.now();
  const eligible = appealEligibility({
    status: row.status,
    appealDeadlineAt: row.appealDeadlineAt,
    appealFiledAt: row.appealFiledAt,
    userId: input.userId,
    buyerUserId: row.buyerUserId,
    sellerUserId: row.sellerUserId,
    now,
  });
  if (!eligible.allowed) throw appealRefused(eligible.reason);

  const updated = await moveCase(tx, row, {
    action: 'APPEAL',
    to: 'APPEALED',
    actor: input.actor,
    reason: input.reason,
    set: { appealFiledAt: now },
  });

  await writeDisputeAudit(tx, input.actor, DISPUTE_AUDIT.APPEALED, {
    disputeId: row.id,
    tradeId: row.tradeId,
  });

  await publish(tx, disputeAppealed, {
    payload: {
      disputeId: row.id,
      disputeNumber: row.disputeNumber,
      tradeId: row.tradeId,
      filedByUserId: input.userId,
      reason: input.reason.trim(),
    },
    aggregateType: 'disputes.dispute',
    aggregateId: row.id,
  });

  return toDisputeView(updated, now);
}

export interface DecideAppealInput {
  disputeId: string;
  leadId: string;
  appealOutcome: AppealOutcome;
  /** Required on OVERTURN; ignored on UPHOLD, which keeps the original decision's money. */
  outcome?: DecisionOutcome;
  amounts?: DecisionAmounts;
  rationale: string;
  actor: DisputeActor;
}

/**
 * The final word. Both outcomes write a NEW decision log row rather than editing the original
 * (M3 D6) — an UPHOLD records that the original was examined and stood, which is a different fact
 * from no appeal having happened, and an OVERTURN records the new money beside the old rather
 * than in place of it.
 *
 * An UPHOLD therefore repeats the original amounts. That is deliberate: the log read on its own,
 * newest row last, always says what the final money instruction is, without a reader having to
 * know that UPHOLD means "look at the row before".
 */
export async function decideAppeal(
  ports: DisputePorts,
  tx: Tx,
  input: DecideAppealInput,
): Promise<{ dispute: DisputeView; decision: DecisionView }> {
  const row = await lockDispute(tx, input.disputeId);
  if (!row) throw disputeNotFound();

  // D5's core rule: never the original reviewer.
  const related = await ports.relatedUsers(tx, {
    buyerUserId: row.buyerUserId,
    sellerUserId: row.sellerUserId,
  });
  const eligible = reviewerEligibility({
    reviewerId: input.leadId,
    buyerUserId: row.buyerUserId,
    sellerUserId: row.sellerUserId,
    originalReviewerId: row.assignedReviewerId,
    isAppeal: true,
    sharedDeviceUserIds: related.sharedDeviceUserIds,
    sharedPayoutUserIds: related.sharedPayoutUserIds,
  });
  if (!eligible.allowed) throw reviewerRefused(eligible.reason);

  const original = await latestDecision(tx, row.id);
  const final =
    input.appealOutcome === 'OVERTURN'
      ? { outcome: requireOverturn(input).outcome, amounts: requireOverturn(input).amounts }
      : {
          outcome: original.outcome,
          amounts: {
            toBuyerMinor: original.amountToBuyerMinor,
            toSellerMinor: original.amountToSellerMinor,
          },
        };

  assertDecisionSums(final.outcome, final.amounts, row.totalEscrowMinor);

  const now = ports.now();
  const [decision] = await tx
    .insert(disputeDecisionLog)
    .values({
      disputeId: row.id,
      decisionType: 'APPEAL',
      decidedByUserId: input.leadId,
      outcome: final.outcome,
      amountToBuyerMinor: final.amounts.toBuyerMinor,
      amountToSellerMinor: final.amounts.toSellerMinor,
      appealOutcome: input.appealOutcome,
      rationale: input.rationale.trim(),
    })
    .returning();
  if (!decision) throw new Error('disputes: the appeal decision insert returned no row');

  const updated = await moveCase(tx, row, {
    action: 'DECIDE_APPEAL',
    to: 'CLOSED',
    actor: input.actor,
    reason: input.rationale,
    set: { closedAt: now },
  });

  await writeDisputeAudit(tx, input.actor, DISPUTE_AUDIT.APPEAL_DECIDED, {
    disputeId: row.id,
    decisionId: String(decision.id),
    appealOutcome: input.appealOutcome,
  });

  await publish(tx, disputeAppealResolved, {
    payload: {
      disputeId: row.id,
      disputeNumber: row.disputeNumber,
      tradeId: row.tradeId,
      appealOutcome: input.appealOutcome,
      outcome: final.outcome,
      totalEscrowMinor: row.totalEscrowMinor.toString(),
      amountToBuyerMinor: final.amounts.toBuyerMinor.toString(),
      amountToSellerMinor: final.amounts.toSellerMinor.toString(),
      decidedByUserId: input.leadId,
      rationale: decision.rationale,
    },
    aggregateType: 'disputes.dispute',
    aggregateId: row.id,
  });

  await publish(tx, disputeClosed, {
    payload: {
      disputeId: row.id,
      disputeNumber: row.disputeNumber,
      tradeId: row.tradeId,
      from: row.status,
      reason: 'APPEAL_DECIDED',
      closedAt: now.toISOString(),
    },
    aggregateType: 'disputes.dispute',
    aggregateId: row.id,
  });

  return { dispute: toDisputeView(updated, now), decision: toDecisionView(decision) };
}

/** An OVERTURN that names no new money is not an overturn; it is an incomplete form. */
function requireOverturn(input: DecideAppealInput): { outcome: DecisionOutcome; amounts: DecisionAmounts } {
  if (!input.outcome || !input.amounts) {
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'An overturned decision needs a new outcome and new amounts',
      'Say what the money should be instead; to leave it as it was, uphold the decision.',
      [{ path: 'outcome', message: 'Required when the appeal outcome is OVERTURN' }],
    );
  }
  return { outcome: input.outcome, amounts: input.amounts };
}

/** The decision an UPHOLD repeats and an OVERTURN replaces: the newest row on the log. */
async function latestDecision(tx: Tx, disputeId: string) {
  const [row] = await tx
    .select()
    .from(disputeDecisionLog)
    .where(eq(disputeDecisionLog.disputeId, disputeId))
    .orderBy(desc(disputeDecisionLog.id))
    .limit(1);
  // A case in APPEAL_UNDER_REVIEW without a decision on the log is a corrupted case, not a user
  // error: the only route into that state runs through `decideDispute`.
  if (!row) throw new Error(`disputes: case ${disputeId} is under appeal with no decision on record`);
  return row;
}

/**
 * M3 D5's quiet ending: nobody appealed, the window lapsed, the decision is final. Driven by the
 * appeal-deadline sweep, so the actor is SYSTEM.
 */
export async function lapseAppealWindow(
  ports: DisputePorts,
  tx: Tx,
  input: { disputeId: string; actor: DisputeActor },
): Promise<void> {
  const row = await lockDispute(tx, input.disputeId);
  if (!row) throw disputeNotFound();

  const now = ports.now();
  await moveCase(tx, row, {
    action: 'LAPSE',
    to: 'CLOSED',
    actor: input.actor,
    reason: 'The appeal window closed with no appeal filed',
    set: { closedAt: now },
  });

  await publish(tx, disputeClosed, {
    payload: {
      disputeId: row.id,
      disputeNumber: row.disputeNumber,
      tradeId: row.tradeId,
      from: row.status,
      reason: 'APPEAL_WINDOW_LAPSED',
      closedAt: now.toISOString(),
    },
    aggregateType: 'disputes.dispute',
    aggregateId: row.id,
  });
}
