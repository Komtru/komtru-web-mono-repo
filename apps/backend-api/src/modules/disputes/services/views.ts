// How a dispute row is shown. The views carry the derived things a screen would otherwise have to
// work out for itself — the case code, which window is running and how long is left on it — so
// Customer-8's timeline and Y1's countdown read one number rather than doing date arithmetic in a
// component.
import { disputeCode, type DisputeStatus } from '../domain/types.js';
import { remaining, type Remaining } from '../domain/windows.js';
import type { disputeCases } from '../infrastructure/postgres/schema/disputes.js';
import type { disputeDecisionLog } from '../infrastructure/postgres/schema/decisions.js';
import type { disputeEvidence } from '../infrastructure/postgres/schema/evidence.js';
import type { disputeMediationProposals } from '../infrastructure/postgres/schema/mediation.js';
import type { disputeStatusChanges } from '../infrastructure/postgres/schema/statusChanges.js';

export type DisputeRow = typeof disputeCases.$inferSelect;
export type EvidenceRow = typeof disputeEvidence.$inferSelect;
export type DecisionRow = typeof disputeDecisionLog.$inferSelect;
export type ProposalRow = typeof disputeMediationProposals.$inferSelect;
export type StatusChangeRow = typeof disputeStatusChanges.$inferSelect;

/** Which side of the case the person reading it is on. */
export type PartyRole = 'BUYER' | 'SELLER';

export const partyRole = (row: DisputeRow, userId: string): PartyRole | null =>
  userId === row.buyerUserId ? 'BUYER' : userId === row.sellerUserId ? 'SELLER' : null;

/**
 * The clock that matters right now, and how long is on it. One field rather than three nullable
 * ones, because a screen asks "what are we waiting for?" and should not have to rank the answers.
 */
export interface ActiveWindow {
  kind: 'MEDIATION' | 'EVIDENCE' | 'APPEAL' | 'NONE';
  deadlineAt: Date | null;
  remaining: Remaining | null;
}

const activeWindow = (row: DisputeRow, now: Date): ActiveWindow => {
  const window = (kind: ActiveWindow['kind'], deadlineAt: Date): ActiveWindow => ({
    kind,
    deadlineAt,
    remaining: remaining(deadlineAt, now),
  });
  switch (row.status) {
    case 'MEDIATION':
      return window('MEDIATION', row.mediationDeadlineAt);
    case 'OPEN_EVIDENCE_COLLECTION':
      return window('EVIDENCE', row.evidenceDeadlineAt);
    case 'DECIDED':
      return row.appealDeadlineAt ? window('APPEAL', row.appealDeadlineAt) : NO_WINDOW;
    default:
      // UNDER_REVIEW, APPEALED and APPEAL_UNDER_REVIEW wait on a person, not a clock, and CLOSED
      // waits on nothing. Promising a countdown there would be inventing a deadline.
      return NO_WINDOW;
  }
};

const NO_WINDOW: ActiveWindow = { kind: 'NONE', deadlineAt: null, remaining: null };

export interface DisputeView {
  id: string;
  disputeNumber: number;
  code: string;
  tradeId: string;
  orderId: string | null;
  status: DisputeStatus;
  category: DisputeRow['category'];
  creationPath: DisputeRow['creationPath'];
  openedReason: string;
  openedByUserId: string;
  buyerUserId: string;
  sellerUserId: string;
  totalEscrowMinor: string;
  window: ActiveWindow;
  mediationDeadlineAt: Date;
  evidenceDeadlineAt: Date;
  evidenceReopenedAt: Date | null;
  decidedAt: Date | null;
  appealDeadlineAt: Date | null;
  appealFiledAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
}

/** Kobo leaves as a digit string: a JSON number would lose it past 2^53. */
export const toDisputeView = (row: DisputeRow, now: Date = new Date()): DisputeView => ({
  id: row.id,
  disputeNumber: row.disputeNumber,
  code: disputeCode(row.disputeNumber),
  tradeId: row.tradeId,
  orderId: row.orderId,
  status: row.status,
  category: row.category,
  creationPath: row.creationPath,
  openedReason: row.openedReason,
  openedByUserId: row.openedByUserId,
  buyerUserId: row.buyerUserId,
  sellerUserId: row.sellerUserId,
  totalEscrowMinor: row.totalEscrowMinor.toString(),
  window: activeWindow(row, now),
  mediationDeadlineAt: row.mediationDeadlineAt,
  evidenceDeadlineAt: row.evidenceDeadlineAt,
  evidenceReopenedAt: row.evidenceReopenedAt,
  decidedAt: row.decidedAt,
  appealDeadlineAt: row.appealDeadlineAt,
  appealFiledAt: row.appealFiledAt,
  closedAt: row.closedAt,
  createdAt: row.createdAt,
});

export interface EvidenceView {
  id: string;
  disputeId: string;
  submittedByUserId: string;
  fileRefId: string | null;
  note: string | null;
  submittedAfterDeadline: boolean;
  submittedAt: Date;
}
export const toEvidenceView = (row: EvidenceRow): EvidenceView => ({ ...row });

export interface DecisionView {
  id: string;
  disputeId: string;
  decisionType: DecisionRow['decisionType'];
  decidedByUserId: string | null;
  outcome: DecisionRow['outcome'];
  amountToBuyerMinor: string;
  amountToSellerMinor: string;
  appealOutcome: DecisionRow['appealOutcome'];
  rationale: string;
  agreedNote: string | null;
  decidedAt: Date;
}
export const toDecisionView = (row: DecisionRow): DecisionView => ({
  id: String(row.id),
  disputeId: row.disputeId,
  decisionType: row.decisionType,
  decidedByUserId: row.decidedByUserId,
  outcome: row.outcome,
  amountToBuyerMinor: row.amountToBuyerMinor.toString(),
  amountToSellerMinor: row.amountToSellerMinor.toString(),
  appealOutcome: row.appealOutcome,
  rationale: row.rationale,
  agreedNote: row.agreedNote,
  decidedAt: row.decidedAt,
});

export interface ProposalView {
  id: string;
  disputeId: string;
  proposedByUserId: string;
  outcome: ProposalRow['outcome'];
  amountToBuyerMinor: string;
  amountToSellerMinor: string;
  note: string | null;
  status: ProposalRow['status'];
  respondedByUserId: string | null;
  respondedAt: Date | null;
  createdAt: Date;
}
export const toProposalView = (row: ProposalRow): ProposalView => ({
  id: row.id,
  disputeId: row.disputeId,
  proposedByUserId: row.proposedByUserId,
  outcome: row.outcome,
  amountToBuyerMinor: row.amountToBuyerMinor.toString(),
  amountToSellerMinor: row.amountToSellerMinor.toString(),
  note: row.note,
  status: row.status,
  respondedByUserId: row.respondedByUserId,
  respondedAt: row.respondedAt,
  createdAt: row.createdAt,
});

export interface TimelineView {
  id: number;
  occurredAt: Date;
  fromStatus: DisputeStatus | null;
  toStatus: DisputeStatus;
  action: string;
  actorType: StatusChangeRow['actorType'];
  actorId: string | null;
  reason: string | null;
}
export const toTimelineView = (row: StatusChangeRow): TimelineView => ({ ...row });
