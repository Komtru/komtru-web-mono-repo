// Disputes (F-032, T-080 and T-081). Mirrors
// `apps/backend-api/src/modules/disputes/http/routes.ts` field for field.
//
// Money is a digit string here and all the way into the component. A dispute amount is never a
// JavaScript number anywhere in the client: `formatNaira` from `@komtru/shared-types` takes the
// bigint, and nothing else needs to do arithmetic on it.
//
// Timestamps are ISO strings, as everywhere else in this package — the server sends them as
// strings and a screen formats them; parsing to Date in the contract would only hide where the
// conversion happens.
import { cursorPageRequestSchema, koboJsonSchema, paginatedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { defineEndpoint } from './contracts.js';

const disputeParams = z.object({ id: z.uuid() });
const proposalParams = z.object({ id: z.uuid(), proposalId: z.uuid() });

/** M3's seven states, with C13's `MEDIATION` first. */
export const DISPUTE_STATUSES = [
  'MEDIATION',
  'OPEN_EVIDENCE_COLLECTION',
  'UNDER_REVIEW',
  'DECIDED',
  'APPEALED',
  'APPEAL_UNDER_REVIEW',
  'CLOSED',
] as const;
export const disputeStatusSchema = z.enum(DISPUTE_STATUSES);
export type DisputeStatus = z.infer<typeof disputeStatusSchema>;

/** The categories a party may file under. Staff escalation has a wider set the app never sends. */
export const DISPUTE_CATEGORIES = [
  'ITEM_NOT_RECEIVED',
  'ITEM_NOT_AS_DESCRIBED',
  'PAYMENT_ISSUE',
  'OTHER',
] as const;
export const disputeCategorySchema = z.enum(DISPUTE_CATEGORIES);
export type DisputeCategory = z.infer<typeof disputeCategorySchema>;

/** M3 D4. The same four whether a reviewer decides them or the parties agree them. */
export const DECISION_OUTCOMES = [
  'REFUND_BUYER_FULL',
  'REFUND_BUYER_PARTIAL',
  'RELEASE_SELLER_FULL',
  'RELEASE_SELLER_PARTIAL',
] as const;
export const decisionOutcomeSchema = z.enum(DECISION_OUTCOMES);
export type DecisionOutcome = z.infer<typeof decisionOutcomeSchema>;

export const DECISION_TYPES = ['ORIGINAL', 'MEDIATED', 'APPEAL'] as const;
export const APPEAL_OUTCOMES = ['UPHOLD', 'OVERTURN'] as const;
export const MEDIATION_PROPOSAL_STATUSES = ['PROPOSED', 'ACCEPTED', 'DECLINED', 'SUPERSEDED'] as const;

/** Which clock is running, so a screen asks once rather than ranking three nullable deadlines. */
export const WINDOW_KINDS = ['MEDIATION', 'EVIDENCE', 'APPEAL', 'NONE'] as const;

const remainingSchema = z.object({
  hours: z.number().int().min(0),
  minutes: z.number().int().min(0),
  expired: z.boolean(),
});
export type Remaining = z.infer<typeof remainingSchema>;

const windowSchema = z.object({
  kind: z.enum(WINDOW_KINDS),
  deadlineAt: z.string().nullable(),
  remaining: remainingSchema.nullable(),
});
export type DisputeWindow = z.infer<typeof windowSchema>;

export const disputeSchema = z.looseObject({
  id: z.uuid(),
  disputeNumber: z.number().int().positive(),
  /** `DIS-088213`, as CWT-S15 and CWT-S18 print it. */
  code: z.string(),
  tradeId: z.uuid(),
  orderId: z.uuid().nullable(),
  status: disputeStatusSchema,
  category: z.string(),
  creationPath: z.enum(['DIRECT_FILING', 'TICKET_ESCALATION']),
  openedReason: z.string(),
  openedByUserId: z.uuid(),
  buyerUserId: z.uuid(),
  sellerUserId: z.uuid(),
  totalEscrowMinor: koboJsonSchema,
  window: windowSchema,
  mediationDeadlineAt: z.string(),
  evidenceDeadlineAt: z.string(),
  evidenceReopenedAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
  appealDeadlineAt: z.string().nullable(),
  appealFiledAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Dispute = z.infer<typeof disputeSchema>;

export const decisionSchema = z.looseObject({
  id: z.string(),
  disputeId: z.uuid(),
  decisionType: z.enum(DECISION_TYPES),
  /** Null on a mediated outcome: the parties agreed it, so no reviewer decided it. */
  decidedByUserId: z.uuid().nullable(),
  outcome: decisionOutcomeSchema,
  amountToBuyerMinor: koboJsonSchema,
  amountToSellerMinor: koboJsonSchema,
  appealOutcome: z.enum(APPEAL_OUTCOMES).nullable(),
  /** H1's "What TrustOps decided" card. */
  rationale: z.string(),
  /** Q10: the agreed words behind a replacement or a refund-with-return. */
  agreedNote: z.string().nullable(),
  decidedAt: z.string(),
});
export type DisputeDecision = z.infer<typeof decisionSchema>;

export const proposalSchema = z.looseObject({
  id: z.uuid(),
  disputeId: z.uuid(),
  proposedByUserId: z.uuid(),
  outcome: decisionOutcomeSchema,
  amountToBuyerMinor: koboJsonSchema,
  amountToSellerMinor: koboJsonSchema,
  note: z.string().nullable(),
  status: z.enum(MEDIATION_PROPOSAL_STATUSES),
  respondedByUserId: z.uuid().nullable(),
  respondedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type MediationProposal = z.infer<typeof proposalSchema>;

export const disputeEvidenceSchema = z.looseObject({
  id: z.uuid(),
  disputeId: z.uuid(),
  submittedByUserId: z.uuid(),
  fileRefId: z.uuid().nullable(),
  note: z.string().nullable(),
  submittedAfterDeadline: z.boolean(),
  submittedAt: z.string(),
});
export type DisputeEvidence = z.infer<typeof disputeEvidenceSchema>;

export const disputeDetailSchema = disputeSchema.extend({
  /** Which side you are on, so H1 and H2 pick their copy without comparing user ids. */
  yourRole: z.enum(['BUYER', 'SELLER']),
  decisions: z.array(decisionSchema),
  proposals: z.array(proposalSchema),
});
export type DisputeDetail = z.infer<typeof disputeDetailSchema>;

const comparisonPanelSchema = z.looseObject({
  role: z.enum(['BUYER', 'SELLER']),
  userId: z.uuid(),
  fromTrade: z.array(
    z.looseObject({
      id: z.string(),
      fileRefId: z.uuid(),
      event: z.enum(['DISPATCH', 'DELIVERY', 'INSPECTION', 'ISSUE']),
      uploadedByUserId: z.uuid(),
      capturedAt: z.string(),
    }),
  ),
  fromDispute: z.array(disputeEvidenceSchema),
});
export type ComparisonPanel = z.infer<typeof comparisonPanelSchema>;

/**
 * Y1. Both panels are always present, even when one holds nothing: an empty panel means "nothing
 * was submitted", and leaving it out would read as an accusation.
 */
export const comparisonSchema = z.looseObject({
  disputeId: z.uuid(),
  tradeId: z.uuid(),
  seller: comparisonPanelSchema,
  buyer: comparisonPanelSchema,
  custody: z.array(
    z.looseObject({
      id: z.string(),
      fileRefId: z.uuid(),
      hubName: z.string().nullable(),
      takenAt: z.string(),
    }),
  ),
  timeline: z.array(z.looseObject({ at: z.string(), kind: z.string(), detail: z.string().nullable() })),
  mediation: z.looseObject({ deadlineAt: z.string(), remaining: remainingSchema }).nullable(),
});
export type EvidenceComparison = z.infer<typeof comparisonSchema>;

export const timelineEntrySchema = z.looseObject({
  id: z.number().int(),
  occurredAt: z.string(),
  fromStatus: disputeStatusSchema.nullable(),
  toStatus: disputeStatusSchema,
  action: z.string(),
  actorType: z.enum(['BUYER', 'SELLER', 'REVIEWER', 'SYSTEM']),
  actorId: z.uuid().nullable(),
  reason: z.string().nullable(),
});
export type DisputeTimelineEntry = z.infer<typeof timelineEntrySchema>;

export const MAX_REASON_LENGTH = 2000;

// ------------------------------------------------------------------ endpoints

/** C7 / CWT-S14: report an issue and open the case. */
export const openDispute = defineEndpoint({
  method: 'post',
  path: '/trades/:id/dispute',
  scope: 'CONSUMER',
  retryable: true,
  schema: {
    params: z.object({ id: z.uuid() }),
    body: z.object({
      category: disputeCategorySchema,
      reason: z.string().trim().min(1).max(MAX_REASON_LENGTH),
    }),
    response: disputeSchema,
  },
});

/** The workspace's DISPUTED body. Null when the trade has no case. */
export const getTradeDispute = defineEndpoint({
  method: 'get',
  path: '/trades/:id/dispute',
  scope: 'CONSUMER',
  schema: { params: z.object({ id: z.uuid() }), response: disputeSchema.nullable() },
});

export const listDisputes = defineEndpoint({
  method: 'get',
  path: '/disputes',
  scope: 'CONSUMER',
  paginated: 'cursor',
  schema: {
    query: cursorPageRequestSchema.extend({ status: disputeStatusSchema.optional() }),
    response: paginatedSchema(disputeSchema),
  },
});

/** C8 / CWT-S15 / H1 / H2. */
export const getDispute = defineEndpoint({
  method: 'get',
  path: '/disputes/:id',
  scope: 'CONSUMER',
  schema: { params: disputeParams, response: disputeDetailSchema },
});

/** C8's step rail. */
export const getDisputeTimeline = defineEndpoint({
  method: 'get',
  path: '/disputes/:id/timeline',
  scope: 'CONSUMER',
  paginated: 'cursor',
  schema: {
    params: disputeParams,
    query: cursorPageRequestSchema,
    response: paginatedSchema(timelineEntrySchema),
  },
});

export const listDisputeEvidence = defineEndpoint({
  method: 'get',
  path: '/disputes/:id/evidence',
  scope: 'CONSUMER',
  paginated: 'cursor',
  schema: {
    params: disputeParams,
    query: cursorPageRequestSchema,
    response: paginatedSchema(disputeEvidenceSchema),
  },
});

/** Y1 (T-081). */
export const getEvidenceComparison = defineEndpoint({
  method: 'get',
  path: '/disputes/:id/evidence-comparison',
  scope: 'CONSUMER',
  schema: { params: disputeParams, response: comparisonSchema },
});

/** S8 / CWT-S13: upload first with `uploadFile`, then name the file id here. */
export const submitDisputeEvidence = defineEndpoint({
  method: 'post',
  path: '/disputes/:id/evidence',
  scope: 'CONSUMER',
  retryable: true,
  schema: {
    params: disputeParams,
    body: z.object({
      fileRefId: z.uuid().optional(),
      note: z.string().trim().min(1).max(4000).optional(),
    }),
    response: disputeEvidenceSchema,
  },
});

/** Y1's "Submit for mediation". */
export const proposeSettlement = defineEndpoint({
  method: 'post',
  path: '/disputes/:id/mediation/proposals',
  scope: 'CONSUMER',
  retryable: true,
  schema: {
    params: disputeParams,
    body: z.object({
      outcome: decisionOutcomeSchema,
      amountToBuyerMinor: koboJsonSchema,
      amountToSellerMinor: koboJsonSchema,
      note: z.string().trim().min(1).max(1000).optional(),
    }),
    response: proposalSchema,
  },
});

/** Accepting resolves the case, so this one is idempotency-key guarded on the platform. */
export const respondToSettlement = defineEndpoint({
  method: 'post',
  path: '/disputes/:id/mediation/proposals/:proposalId/respond',
  scope: 'CONSUMER',
  retryable: true,
  schema: {
    params: proposalParams,
    body: z.object({ accept: z.boolean() }),
    response: z.looseObject({ proposal: proposalSchema, dispute: disputeSchema.nullable() }),
  },
});

/** SP-M23. Only the person who opened it, and only during mediation. */
export const withdrawDispute = defineEndpoint({
  method: 'post',
  path: '/disputes/:id/withdraw',
  scope: 'CONSUMER',
  retryable: true,
  schema: {
    params: disputeParams,
    body: z.object({ reason: z.string().trim().min(1).max(MAX_REASON_LENGTH) }),
    response: disputeSchema,
  },
});

/** AC6. One per case, inside the window. */
export const appealDispute = defineEndpoint({
  method: 'post',
  path: '/disputes/:id/appeal',
  scope: 'CONSUMER',
  retryable: true,
  schema: {
    params: disputeParams,
    body: z.object({ reason: z.string().trim().min(1).max(MAX_REASON_LENGTH) }),
    response: disputeSchema,
  },
});
