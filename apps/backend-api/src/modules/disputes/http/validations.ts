// Schemas for the dispute routes. Every request body is a `strictObject`: a decision body
// carrying an unknown member — an amount under a name this module does not read, say — is refused
// rather than quietly ignored, because the member it ignored might have been the one the caller
// thought set the money.
//
// Amounts are `koboJsonSchema`: a digit string, validated but not decoded, so a JSON number can
// never reach a money field and lose kobo on the way.
import { koboJsonSchema, paginatedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import {
  APPEAL_OUTCOMES,
  DECISION_OUTCOMES,
  DECISION_TYPES,
  DISPUTE_CATEGORIES,
  DISPUTE_CREATION_PATHS,
  DISPUTE_STATUSES,
  MEDIATION_PROPOSAL_STATUSES,
} from '../domain/types.js';
import { PARTY_CATEGORIES } from '../services/ports.js';
import { REVIEWER_QUEUE_VIEWS } from '../services/read.service.js';

export const idParams = z.object({ id: z.uuid() });
export const tradeIdParams = z.object({ id: z.uuid() });
export const proposalParams = z.object({ id: z.uuid(), proposalId: z.uuid() });

const reason = z.string().trim().min(1).max(2000);
const rationale = z.string().trim().min(1).max(4000);

// ---------------------------------------------------------------- request bodies

export const openDisputeBody = z.strictObject({
  category: z.enum(PARTY_CATEGORIES as [string, ...string[]]),
  reason,
});

export const openInternalBody = z.strictObject({
  tradeId: z.uuid(),
  /** The party the case belongs to, not the agent escalating it. */
  openedByUserId: z.uuid(),
  category: z.enum(DISPUTE_CATEGORIES),
  reason,
  creationPath: z.enum(DISPUTE_CREATION_PATHS).default('TICKET_ESCALATION'),
  sourceTicketId: z.uuid().optional(),
});

export const submitEvidenceBody = z
  .strictObject({
    /** A finalised upload of your own; the file itself never passes through this endpoint. */
    fileRefId: z.uuid().optional(),
    note: z.string().trim().min(1).max(4000).optional(),
  })
  // The table's CHECK says the same thing; saying it here too turns a 500 into a 422 with a field.
  .refine((body) => body.fileRefId !== undefined || body.note !== undefined, {
    message: 'Add a photo or write what happened',
    path: ['note'],
  });

export const proposeBody = z.strictObject({
  outcome: z.enum(DECISION_OUTCOMES),
  amountToBuyerMinor: koboJsonSchema,
  amountToSellerMinor: koboJsonSchema,
  /** Q10: "we agreed a replacement", "refund once it's back with me". */
  note: z.string().trim().min(1).max(1000).optional(),
});

export const respondBody = z.strictObject({ accept: z.boolean() });

export const withdrawBody = z.strictObject({ reason });

export const appealBody = z.strictObject({ reason });

export const assignBody = z.strictObject({ reviewerId: z.uuid(), reason: z.string().max(1000).optional() });

export const decideBody = z.strictObject({
  outcome: z.enum(DECISION_OUTCOMES),
  amountToBuyerMinor: koboJsonSchema,
  amountToSellerMinor: koboJsonSchema,
  rationale,
});

export const appealDecideBody = z.strictObject({
  appealOutcome: z.enum(APPEAL_OUTCOMES),
  /** Required when OVERTURN; the service refuses an overturn with no new money. */
  outcome: z.enum(DECISION_OUTCOMES).optional(),
  amountToBuyerMinor: koboJsonSchema.optional(),
  amountToSellerMinor: koboJsonSchema.optional(),
  rationale,
});

export const reopenEvidenceBody = z.strictObject({ reason });

// ---------------------------------------------------------------- queries

export const listQuery = z.object({ status: z.enum(DISPUTE_STATUSES).optional() });

export const queueQuery = z.object({
  view: z.enum(REVIEWER_QUEUE_VIEWS).default('all'),
  /** `DIS-088213`, `088213` or `88213`. */
  q: z.string().trim().min(1).max(20).optional(),
});

// ---------------------------------------------------------------- responses

const remainingView = z.object({
  hours: z.number().int().min(0),
  minutes: z.number().int().min(0),
  expired: z.boolean(),
});

const windowView = z.object({
  kind: z.enum(['MEDIATION', 'EVIDENCE', 'APPEAL', 'NONE']),
  deadlineAt: z.date().nullable(),
  remaining: remainingView.nullable(),
});

export const disputeView = z.object({
  id: z.uuid(),
  disputeNumber: z.number().int().positive(),
  code: z.string(),
  tradeId: z.uuid(),
  orderId: z.uuid().nullable(),
  status: z.enum(DISPUTE_STATUSES),
  category: z.enum(DISPUTE_CATEGORIES),
  creationPath: z.enum(DISPUTE_CREATION_PATHS),
  openedReason: z.string(),
  openedByUserId: z.uuid(),
  buyerUserId: z.uuid(),
  sellerUserId: z.uuid(),
  totalEscrowMinor: koboJsonSchema,
  window: windowView,
  mediationDeadlineAt: z.date(),
  evidenceDeadlineAt: z.date(),
  evidenceReopenedAt: z.date().nullable(),
  decidedAt: z.date().nullable(),
  appealDeadlineAt: z.date().nullable(),
  appealFiledAt: z.date().nullable(),
  closedAt: z.date().nullable(),
  createdAt: z.date(),
});

export const decisionView = z.object({
  id: z.string(),
  disputeId: z.uuid(),
  decisionType: z.enum(DECISION_TYPES),
  decidedByUserId: z.uuid().nullable(),
  outcome: z.enum(DECISION_OUTCOMES),
  amountToBuyerMinor: koboJsonSchema,
  amountToSellerMinor: koboJsonSchema,
  appealOutcome: z.enum(APPEAL_OUTCOMES).nullable(),
  rationale: z.string(),
  agreedNote: z.string().nullable(),
  decidedAt: z.date(),
});

export const proposalView = z.object({
  id: z.uuid(),
  disputeId: z.uuid(),
  proposedByUserId: z.uuid(),
  outcome: z.enum(DECISION_OUTCOMES),
  amountToBuyerMinor: koboJsonSchema,
  amountToSellerMinor: koboJsonSchema,
  note: z.string().nullable(),
  status: z.enum(MEDIATION_PROPOSAL_STATUSES),
  respondedByUserId: z.uuid().nullable(),
  respondedAt: z.date().nullable(),
  createdAt: z.date(),
});

export const evidenceView = z.object({
  id: z.uuid(),
  disputeId: z.uuid(),
  submittedByUserId: z.uuid(),
  fileRefId: z.uuid().nullable(),
  note: z.string().nullable(),
  submittedAfterDeadline: z.boolean(),
  submittedAt: z.date(),
});

export const disputeDetail = disputeView.extend({
  yourRole: z.enum(['BUYER', 'SELLER']),
  decisions: z.array(decisionView),
  proposals: z.array(proposalView),
});

const tradeMediaView = z.object({
  id: z.string(),
  fileRefId: z.uuid(),
  event: z.enum(['DISPATCH', 'DELIVERY', 'INSPECTION', 'ISSUE']),
  uploadedByUserId: z.uuid(),
  capturedAt: z.date(),
});

const panelView = z.object({
  role: z.enum(['BUYER', 'SELLER']),
  userId: z.uuid(),
  fromTrade: z.array(tradeMediaView),
  fromDispute: z.array(evidenceView),
});

/** Y1 and Z6. Both panels are always present, even when one is empty — see the service's note. */
export const comparisonResponse = z.object({
  disputeId: z.uuid(),
  tradeId: z.uuid(),
  seller: panelView,
  buyer: panelView,
  custody: z.array(
    z.object({ id: z.string(), fileRefId: z.uuid(), hubName: z.string().nullable(), takenAt: z.date() }),
  ),
  timeline: z.array(z.object({ at: z.date(), kind: z.string(), detail: z.string().nullable() })),
  mediation: z.object({ deadlineAt: z.date(), remaining: remainingView }).nullable(),
});

export const timelineView = z.object({
  id: z.number().int(),
  occurredAt: z.date(),
  fromStatus: z.enum(DISPUTE_STATUSES).nullable(),
  toStatus: z.enum(DISPUTE_STATUSES),
  action: z.string(),
  actorType: z.enum(['BUYER', 'SELLER', 'REVIEWER', 'SYSTEM']),
  actorId: z.uuid().nullable(),
  reason: z.string().nullable(),
});

export const disputeListResponse = paginatedSchema(disputeView);
export const timelineResponse = paginatedSchema(timelineView);
export const evidenceListResponse = paginatedSchema(evidenceView);
export const decisionResponse = z.object({ dispute: disputeView, decision: decisionView });
export const mediationResponse = z.object({
  proposal: proposalView,
  dispute: disputeView.nullable(),
});
