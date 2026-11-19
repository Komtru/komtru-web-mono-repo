// What a dispute publishes (M3 §6), through the transactional outbox, inside the transaction that
// wrote the change. A consumer that sees one of these can rely on the row being readable.
//
// These payloads are the contract F-033 (return track), F-034 (replacement and mutual settlement)
// and F-035 (the TrustOps decision screen) consume, so they are fixed here deliberately wider than
// this feature needs: `disputeResolved` carries the escrowed total alongside the two shares so a
// consumer can re-check the arithmetic without reading this module's tables, and carries
// `agreedNote` so Q10's "replacement" and "refund with return" survive as the agreed words they
// are rather than being flattened into a money outcome that loses them.
//
// Kobo on the wire is a digit string, not a bigint: the outbox row is jsonb and a bigint cannot be
// serialised into it at all. A consumer that wants arithmetic runs `koboSchema.parse()`.
import { defineEvent, koboJsonSchema } from '@komtru/shared-types';
import { z } from 'zod';
import {
  APPEAL_OUTCOMES,
  DECISION_OUTCOMES,
  DECISION_TYPES,
  DISPUTE_CATEGORIES,
  DISPUTE_CREATION_PATHS,
  DISPUTE_STATUSES,
} from './types.js';

/** Every payload carries both ids: a consumer keyed on the trade never has to look the case up. */
const caseRef = {
  disputeId: z.uuid(),
  disputeNumber: z.number().int().positive(),
  tradeId: z.uuid(),
};

/**
 * M7 listens and transitions itself to `DISPUTED` if it is not already there (M3 D1, Path B);
 * Notifications tells the other party; Audit records it.
 */
export const disputeOpened = defineEvent(
  'disputes.dispute.opened',
  1,
  z.object({
    ...caseRef,
    category: z.enum(DISPUTE_CATEGORIES),
    creationPath: z.enum(DISPUTE_CREATION_PATHS),
    openedByUserId: z.uuid(),
    buyerUserId: z.uuid(),
    sellerUserId: z.uuid(),
    sourceTicketId: z.uuid().nullable(),
    totalEscrowMinor: koboJsonSchema,
    mediationDeadlineAt: z.iso.datetime(),
    evidenceDeadlineAt: z.iso.datetime(),
  }),
);

/** Notifications, to the other party: someone has put something on the record. */
export const disputeEvidenceSubmitted = defineEvent(
  'disputes.evidence.submitted',
  1,
  z.object({
    ...caseRef,
    evidenceId: z.uuid(),
    submittedByUserId: z.uuid(),
    submittedAfterDeadline: z.boolean(),
  }),
);

/** Ops: the case is ready for the reviewer queue. */
export const disputeEvidenceWindowClosed = defineEvent(
  'disputes.evidence.window_closed',
  1,
  z.object({ ...caseRef, closedAt: z.iso.datetime() }),
);

/**
 * C13: the parties settled it themselves. Published alongside `disputeResolved`, not instead of it
 * — the money instruction is the same whoever produced it, and a consumer that only cares about
 * the money should not have to learn that mediation exists.
 */
export const disputeMediationAgreed = defineEvent(
  'disputes.mediation.agreed',
  1,
  z.object({
    ...caseRef,
    proposalId: z.uuid(),
    proposedByUserId: z.uuid(),
    acceptedByUserId: z.uuid(),
    outcome: z.enum(DECISION_OUTCOMES),
    /** Q10: "replacement" and "refund with return", recorded as the agreed words. */
    agreedNote: z.string().nullable(),
  }),
);

export const disputeAssigned = defineEvent(
  'disputes.dispute.assigned',
  1,
  z.object({ ...caseRef, reviewerId: z.uuid(), isAppeal: z.boolean() }),
);

/**
 * The money instruction (M3 §6). M7 moves to `RESOLVED_REFUNDED` / `RESOLVED_RELEASED`; M8 executes
 * the refund or the split; Reputation reads it as a dispute-fault input; Notifications tells both.
 *
 * The two shares sum to `totalEscrowMinor` — checked here, in the DB trigger, and again by the
 * ledger. What this event does NOT say is how the platform commission divides across a partial:
 * that is an open fee question (see the plan's parked list), and a consumer must not infer it.
 */
export const disputeResolved = defineEvent(
  'disputes.dispute.resolved',
  1,
  z.object({
    ...caseRef,
    decisionId: z.string().min(1),
    decisionType: z.enum(DECISION_TYPES),
    outcome: z.enum(DECISION_OUTCOMES),
    totalEscrowMinor: koboJsonSchema,
    amountToBuyerMinor: koboJsonSchema,
    amountToSellerMinor: koboJsonSchema,
    /** Null when a reviewer decided it; the deciding user otherwise. */
    decidedByUserId: z.uuid().nullable(),
    rationale: z.string().min(1),
    agreedNote: z.string().nullable(),
    decidedAt: z.iso.datetime(),
  }),
);

export const disputeAppealed = defineEvent(
  'disputes.appeal.filed',
  1,
  z.object({ ...caseRef, filedByUserId: z.uuid(), reason: z.string().min(1) }),
);

/** M7 and M8 act again only when an OVERTURN changes the money movement. */
export const disputeAppealResolved = defineEvent(
  'disputes.appeal.resolved',
  1,
  z.object({
    ...caseRef,
    appealOutcome: z.enum(APPEAL_OUTCOMES),
    outcome: z.enum(DECISION_OUTCOMES),
    totalEscrowMinor: koboJsonSchema,
    amountToBuyerMinor: koboJsonSchema,
    amountToSellerMinor: koboJsonSchema,
    decidedByUserId: z.uuid(),
    rationale: z.string().min(1),
  }),
);

/** Reputation, Risk & Fraud (M13) and Audit. The case is final from here. */
export const disputeClosed = defineEvent(
  'disputes.dispute.closed',
  1,
  z.object({
    ...caseRef,
    /** Which state it closed out of: a withdrawal and a lapsed appeal window are not the same end. */
    from: z.enum(DISPUTE_STATUSES),
    reason: z.enum(['WITHDRAWN', 'APPEAL_DECIDED', 'APPEAL_WINDOW_LAPSED']),
    closedAt: z.iso.datetime(),
  }),
);

/** Every event this module publishes, for the registry test and for documentation. */
export const DISPUTE_EVENTS = [
  disputeOpened,
  disputeEvidenceSubmitted,
  disputeEvidenceWindowClosed,
  disputeMediationAgreed,
  disputeAssigned,
  disputeResolved,
  disputeAppealed,
  disputeAppealResolved,
  disputeClosed,
] as const;
