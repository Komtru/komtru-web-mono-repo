// The vocabulary of a dispute (M3 §4.1), declared once here and borrowed by the Postgres enums, the
// events and the HTTP schemas. The domain owns the words; nothing else re-declares them.
//
// One addition to M3's own list: `MEDIATION`. Design conflict C13 reconciled the HTML's 48-hour
// auto-mediation window with M3's evidence-then-review machine by making mediation the state a case
// opens in, rather than a second kind of case. The four money outcomes are unchanged — what the
// parties may agree between themselves is exactly what a reviewer could have decided for them.

export const DISPUTE_STATUSES = [
  'MEDIATION',
  'OPEN_EVIDENCE_COLLECTION',
  'UNDER_REVIEW',
  'DECIDED',
  'APPEALED',
  'APPEAL_UNDER_REVIEW',
  'CLOSED',
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/**
 * What moves a case. Named for the thing that happens rather than the state it lands in, because
 * two actions reach `CLOSED` for very different reasons (a withdrawal and a lapsed appeal window)
 * and the status-change log should be able to tell them apart.
 */
export const DISPUTE_ACTIONS = [
  'OPEN',
  'AGREE',
  'WITHDRAW',
  'MEDIATION_LAPSED',
  'CLOSE_EVIDENCE',
  'REOPEN_EVIDENCE',
  'DECIDE',
  'APPEAL',
  'ASSIGN_APPEAL',
  'DECIDE_APPEAL',
  'LAPSE',
] as const;
export type DisputeAction = (typeof DISPUTE_ACTIONS)[number];

export const DISPUTE_CATEGORIES = [
  'ITEM_NOT_RECEIVED',
  'ITEM_NOT_AS_DESCRIBED',
  'PAYMENT_ISSUE',
  'SELLER_UNRESPONSIVE',
  'BUYER_UNRESPONSIVE',
  'OTHER',
] as const;
export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];

/** M3 D1: two doors, one case. The module never branches its logic on which one was used. */
export const DISPUTE_CREATION_PATHS = ['DIRECT_FILING', 'TICKET_ESCALATION'] as const;
export type DisputeCreationPath = (typeof DISPUTE_CREATION_PATHS)[number];

/**
 * M3 D4. A constrained set, never a free-form amount — and the same four whether a reviewer decides
 * them or the parties agree them in mediation.
 */
export const DECISION_OUTCOMES = [
  'REFUND_BUYER_FULL',
  'REFUND_BUYER_PARTIAL',
  'RELEASE_SELLER_FULL',
  'RELEASE_SELLER_PARTIAL',
] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

/**
 * How a decision came about. `MEDIATED` is C13's: the parties agreed it, so no reviewer is named on
 * the row, and it is still an original decision for the purposes of the one appeal M3 D5 allows.
 */
export const DECISION_TYPES = ['ORIGINAL', 'MEDIATED', 'APPEAL'] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

export const APPEAL_OUTCOMES = ['UPHOLD', 'OVERTURN'] as const;
export type AppealOutcome = (typeof APPEAL_OUTCOMES)[number];

export const MEDIATION_PROPOSAL_STATUSES = ['PROPOSED', 'ACCEPTED', 'DECLINED', 'SUPERSEDED'] as const;
export type MediationProposalStatus = (typeof MEDIATION_PROPOSAL_STATUSES)[number];

/** Who moved the case, for the status-change log (M3 §4.5). */
export const DISPUTE_ACTOR_TYPES = ['BUYER', 'SELLER', 'REVIEWER', 'SYSTEM'] as const;
export type DisputeActorType = (typeof DISPUTE_ACTOR_TYPES)[number];

/** `DIS-088213`: how CWT-S15 and CWT-S18 print a case number. */
export const disputeCode = (disputeNumber: number): string => `DIS-${String(disputeNumber).padStart(6, '0')}`;

/**
 * `DIS-088213`, `088213` and `88213` all name case 88213; anything else names no case number.
 * Mirrors `parseCaseNumber` in the cases module so staff can paste either kind of code.
 */
export function parseDisputeNumber(q: string): number | null {
  const match = /^(?:dis-?)?0*(\d{1,12})$/i.exec(q.trim());
  return match?.[1] ? Number(match[1]) : null;
}
