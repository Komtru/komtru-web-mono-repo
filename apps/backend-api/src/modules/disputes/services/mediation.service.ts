// C13's mediation: before a reviewer is involved, each party may propose one of M3's four money
// outcomes and the other may accept it. An accepted proposal resolves the case — the same money
// instruction a reviewer would have produced, with `decisionType: 'MEDIATED'` on the log so the
// record says who actually decided it.
//
// Q10 lives here. "Replacement" and "refund with return" are not money outcomes and are not
// modelled as any: they ride as the agreed `note` on an outcome that IS one, with return shipping
// self-arranged. The platform records what the parties agreed; it does not arrange a return.
import { and, eq } from 'drizzle-orm';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { disputeMediationAgreed, disputeResolved } from '../domain/events.js';
import {
  cannotRespondToOwnProposal,
  disputeNotFound,
  mediationNotOpen,
  mediationProposalNotFound,
  notADisputeParty,
  proposalAlreadyAnswered,
} from '../domain/errors.js';
import { assertDecisionSums, type DecisionAmounts } from '../domain/decision.js';
import type { DecisionOutcome } from '../domain/types.js';
import { appealDeadline } from '../domain/windows.js';
import { disputeDecisionLog } from '../infrastructure/postgres/schema/decisions.js';
import { disputeMediationProposals } from '../infrastructure/postgres/schema/mediation.js';
import type { DisputePorts } from './ports.js';
import { DISPUTE_AUDIT, lockDispute, moveCase, writeDisputeAudit, type DisputeActor } from './transition.js';
import { partyRole, toProposalView, type DisputeView, type ProposalView } from './views.js';
import { toDisputeView } from './views.js';

export interface ProposeInput {
  disputeId: string;
  userId: string;
  outcome: DecisionOutcome;
  amounts: DecisionAmounts;
  note?: string | null;
  actor: DisputeActor;
}

/**
 * Put an offer on the table. The amounts are checked against the escrowed total here, with the
 * same function a reviewer's decision goes through — a party cannot propose a settlement that
 * would not have been a legal decision.
 *
 * Superseding rather than refusing a second proposal: a party changing their offer is the normal
 * shape of a negotiation, and the partial unique index allows only one PROPOSED row per party, so
 * the previous one is marked SUPERSEDED in the same transaction.
 */
export async function proposeMediation(
  ports: DisputePorts,
  tx: Tx,
  input: ProposeInput,
): Promise<ProposalView> {
  const row = await lockDispute(tx, input.disputeId);
  if (!row) throw disputeNotFound();
  if (partyRole(row, input.userId) === null) throw notADisputeParty();
  if (row.status !== 'MEDIATION') throw mediationNotOpen();

  assertDecisionSums(input.outcome, input.amounts, row.totalEscrowMinor);

  await tx
    .update(disputeMediationProposals)
    .set({ status: 'SUPERSEDED', respondedAt: ports.now() })
    .where(
      and(
        eq(disputeMediationProposals.disputeId, row.id),
        eq(disputeMediationProposals.proposedByUserId, input.userId),
        eq(disputeMediationProposals.status, 'PROPOSED'),
      ),
    );

  const [proposal] = await tx
    .insert(disputeMediationProposals)
    .values({
      disputeId: row.id,
      proposedByUserId: input.userId,
      outcome: input.outcome,
      amountToBuyerMinor: input.amounts.toBuyerMinor,
      amountToSellerMinor: input.amounts.toSellerMinor,
      note: input.note?.trim() || null,
    })
    .returning();
  if (!proposal) throw new Error('disputes: the mediation proposal insert returned no row');

  await writeDisputeAudit(tx, input.actor, DISPUTE_AUDIT.MEDIATION_PROPOSED, {
    disputeId: row.id,
    proposalId: proposal.id,
    outcome: input.outcome,
  });

  return toProposalView(proposal);
}

export interface RespondInput {
  disputeId: string;
  proposalId: string;
  userId: string;
  accept: boolean;
  actor: DisputeActor;
}

export interface MediationResult {
  proposal: ProposalView;
  /** Set only when the proposal was accepted and the case therefore resolved. */
  dispute: DisputeView | null;
}

/**
 * Answer the other side's offer. Accepting resolves the case: it writes the decision log row, sets
 * the appeal window running and publishes the same `disputes.dispute.resolved` a reviewer's
 * decision would have — a consumer that only cares about the money never has to learn that
 * mediation exists.
 *
 * M3 D5 still applies to a mediated outcome: it is an original decision, so one appeal remains
 * available. A party who agrees a settlement under pressure is not thereby giving up their appeal.
 */
export async function respondToMediation(
  ports: DisputePorts,
  tx: Tx,
  input: RespondInput,
): Promise<MediationResult> {
  const row = await lockDispute(tx, input.disputeId);
  if (!row) throw disputeNotFound();
  if (partyRole(row, input.userId) === null) throw notADisputeParty();
  if (row.status !== 'MEDIATION') throw mediationNotOpen();

  const [proposal] = await tx
    .select()
    .from(disputeMediationProposals)
    .where(
      and(
        eq(disputeMediationProposals.id, input.proposalId),
        eq(disputeMediationProposals.disputeId, row.id),
      ),
    )
    .for('update');
  if (!proposal) throw mediationProposalNotFound();
  if (proposal.status !== 'PROPOSED') throw proposalAlreadyAnswered();
  // Accepting your own offer would be a one-sided settlement wearing an agreement's clothes.
  if (proposal.proposedByUserId === input.userId) throw cannotRespondToOwnProposal();

  const now = ports.now();
  const [answered] = await tx
    .update(disputeMediationProposals)
    .set({
      status: input.accept ? 'ACCEPTED' : 'DECLINED',
      respondedByUserId: input.userId,
      respondedAt: now,
    })
    .where(eq(disputeMediationProposals.id, proposal.id))
    .returning();
  if (!answered) throw proposalAlreadyAnswered();

  if (!input.accept) return { proposal: toProposalView(answered), dispute: null };

  // Re-checked at acceptance, not just at proposal: the escrowed total is snapshotted and cannot
  // move, but this is the moment money is actually being committed and the cheap check belongs
  // where the commitment is.
  const amounts = {
    toBuyerMinor: proposal.amountToBuyerMinor,
    toSellerMinor: proposal.amountToSellerMinor,
  };
  assertDecisionSums(proposal.outcome, amounts, row.totalEscrowMinor);

  const [decision] = await tx
    .insert(disputeDecisionLog)
    .values({
      disputeId: row.id,
      decisionType: 'MEDIATED',
      decidedByUserId: null,
      outcome: proposal.outcome,
      amountToBuyerMinor: amounts.toBuyerMinor,
      amountToSellerMinor: amounts.toSellerMinor,
      rationale: `Agreed in mediation between the parties (proposal ${proposal.id}).`,
      agreedNote: proposal.note,
    })
    .returning();
  if (!decision) throw new Error('disputes: the mediated decision insert returned no row');

  const appealDays = await ports.appealWindowDays();
  const updated = await moveCase(tx, row, {
    action: 'AGREE',
    to: 'DECIDED',
    actor: input.actor,
    reason: 'Agreed in mediation',
    set: { decidedAt: now, appealDeadlineAt: appealDeadline(now, appealDays) },
  });

  await writeDisputeAudit(tx, input.actor, DISPUTE_AUDIT.MEDIATION_AGREED, {
    disputeId: row.id,
    proposalId: proposal.id,
    outcome: proposal.outcome,
  });

  await publish(tx, disputeMediationAgreed, {
    payload: {
      disputeId: row.id,
      disputeNumber: row.disputeNumber,
      tradeId: row.tradeId,
      proposalId: proposal.id,
      proposedByUserId: proposal.proposedByUserId,
      acceptedByUserId: input.userId,
      outcome: proposal.outcome,
      agreedNote: proposal.note,
    },
    aggregateType: 'disputes.dispute',
    aggregateId: row.id,
  });

  await publish(tx, disputeResolved, {
    payload: {
      disputeId: row.id,
      disputeNumber: row.disputeNumber,
      tradeId: row.tradeId,
      decisionId: String(decision.id),
      decisionType: 'MEDIATED',
      outcome: proposal.outcome,
      totalEscrowMinor: row.totalEscrowMinor.toString(),
      amountToBuyerMinor: amounts.toBuyerMinor.toString(),
      amountToSellerMinor: amounts.toSellerMinor.toString(),
      decidedByUserId: null,
      rationale: decision.rationale,
      agreedNote: proposal.note,
      decidedAt: now.toISOString(),
    },
    aggregateType: 'disputes.dispute',
    aggregateId: row.id,
  });

  return { proposal: toProposalView(answered), dispute: toDisputeView(updated, now) };
}
