// The disputes module's public surface (T-080, T-081).
//
// What other modules get: the schema, the vocabulary, the events they consume, and the one read
// another module legitimately needs — "is there an open dispute on this trade?", which M7's
// inspection and auto-release sweeps ask before they move a trade on. Everything else — opening,
// deciding, appealing — happens through this module's own HTTP surface, because every one of
// those is a money decision with an audit trail attached and there is no second door to it.
import { eq, ne, and } from 'drizzle-orm';
import type { Tx } from '../../platform/events/publish.js';
import { createDisputesModule } from './module.js';
import { disputeCases } from './infrastructure/postgres/schema/disputes.js';

export * from './infrastructure/postgres/schema/index.js';
export * from './domain/types.js';
export * from './domain/events.js';
export { canTransition, isTransitionAllowed, TRANSITIONS } from './domain/stateMachine.js';
export { assertDecisionSums, amountsForOutcome, MEDIATION_OUTCOMES } from './domain/decision.js';
export { appealEligibility } from './domain/appeal.js';
export { reviewerEligibility } from './domain/assignment.js';
export { remaining, type Remaining } from './domain/windows.js';
export { disputeForTrade } from './services/dispute.service.js';
export type { DisputeView, DecisionView } from './services/views.js';
export { createDisputesModule, type DisputesModuleOptions } from './module.js';

/**
 * T-080 closing the `noDisputes` seam in `trades/services/inspectionPorts.ts`: M7's inspection and
 * auto-release sweeps stop for an open dispute (AR1, M7 §6). Any status but CLOSED counts as open
 * — a DECIDED case still has an appeal window running and its money has not finished moving.
 */
export async function hasOpenDispute(tx: Tx, tradeId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: disputeCases.id })
    .from(disputeCases)
    .where(and(eq(disputeCases.tradeId, tradeId), ne(disputeCases.status, 'CLOSED')))
    .limit(1);
  return row !== undefined;
}

export const disputesModule = createDisputesModule();
