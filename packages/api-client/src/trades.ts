// The proposal half of a trade (T-060, T-061): preview, create a draft, send it, and the answers the
// other party gives. Mirrors `apps/backend-api/src/modules/trades/http/trade.routes.ts` field for field.
//
// Money is a digit string of kobo on the wire, both ways. A screen formats it with `formatNaira` and
// never adds, subtracts or multiplies it: the fee lines and totals come from the trade's own snapshot.
import {
  canonicalTradeCodeSchema,
  counterpartyDisplaySchema,
  cursorPageRequestSchema,
  koboJsonSchema,
  tradeActivityResponseSchema,
  tradeByCodeResponseSchema,
  tradeListResponseSchema,
  tradeListStateSchema,
} from '@komtru/shared-types';
import { z } from 'zod';
import { defineEndpoint } from './contracts.js';

export const tradeRoleSchema = z.enum(['BUYER', 'SELLER']);
export type TradeRole = z.infer<typeof tradeRoleSchema>;

const tradeParams = z.object({ id: z.uuid() });
const proofFileIds = z.array(z.uuid()).max(20);
const itemSpec = z.record(z.string().min(1).max(60), z.unknown());

/** The statuses a proposal can be in on the way to being agreed, and the ones it can end in. */
export const PROPOSAL_STATUSES = [
  'DRAFT',
  'PENDING_COUNTERPARTY',
  'UNDER_PROPOSAL_REVIEW',
  'AWAITING_ACCEPTANCE',
  'PENDING_PAYMENT',
  'DECLINED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
] as const;

const feeSnapshot = z.looseObject({
  scheduleVersion: z.string(),
  itemAmountMinor: z.string(),
  buyerProtectionFeeMinor: z.string(),
  buyerTotalMinor: z.string(),
  commissionMinor: z.string(),
  sellerProceedsMinor: z.string(),
});

const terms = z.looseObject({
  versionId: z.uuid(),
  versionNumber: z.number(),
  proposedByRole: tradeRoleSchema,
  itemAmountMinor: z.string(),
  currency: z.string(),
  itemSpec: z.unknown(),
  inspectionWindowHours: z.number(),
  deliveryGraceHours: z.number(),
  deliveryAddress: z.unknown(),
  shipsFromAddress: z.unknown(),
  createdAt: z.string(),
});

/**
 * The trade as its parties see it. `status` stays a string: a status the backend adds later must not
 * make every trade unreadable, and a screen that does not know one falls back to a neutral state.
 */
export const tradeViewSchema = z.looseObject({
  id: z.uuid(),
  tradeCode: z.string(),
  /** `https://app.komtru.com/trades/<code>`: only the code in a link. Opening it needs the right account. */
  shareUrl: z.string(),
  /** The category and the Trade Standard version the trade pinned; all three are null together. */
  categoryCode: z.string().nullable(),
  categoryName: z.string().nullable(),
  standardVersion: z.number().nullable(),
  /** That exact version's id: read it at `GET /config/trade-standards/versions/:id`, however many newer ones exist. */
  standardVersionId: z.uuid().nullable(),
  /** The other party, as the list shows them. Absent on the fulfilment and inspection actions' answers. */
  counterparty: counterpartyDisplaySchema.nullable().optional(),
  status: z.string(),
  statusRevision: z.number(),
  initiatorRole: tradeRoleSchema,
  yourRole: tradeRoleSchema,
  awaiting: z.enum(['YOU', 'COUNTERPARTY']).nullable(),
  terms: terms.nullable(),
  fees: feeSnapshot.nullable(),
  proofMediaCount: z.number(),
  sentAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type TradeView = z.infer<typeof tradeViewSchema>;

export const itemSpecFieldSchema = z.object({ key: z.string(), label: z.string(), required: z.boolean() });
export type ItemSpecField = z.infer<typeof itemSpecFieldSchema>;

export const proofMediaRuleSchema = z.object({ minPhotos: z.number(), requireVideo: z.boolean() });

export const previewResponseSchema = z.looseObject({
  allowedRoles: z.array(tradeRoleSchema),
  standard: z.object({
    categoryCode: z.string(),
    versionNumber: z.number(),
    inspectionWindowHours: z.number(),
    itemSpecFields: z.array(itemSpecFieldSchema),
    proofMedia: proofMediaRuleSchema,
    deliveryDeadlineDays: z.number(),
  }),
  fees: z.array(
    z.object({
      sellerKind: z.enum(['CASUAL', 'MERCHANT']),
      snapshot: z.looseObject({
        amounts: z.looseObject({
          itemMinor: z.string(),
          buyerProtectionFeeMinor: z.string(),
          buyerTotalMinor: z.string(),
          sellerProceedsMinor: z.string(),
        }),
      }),
    }),
  ),
});
export type TradePreview = z.infer<typeof previewResponseSchema>;

/** Z3: the sides this person may take, the category's requirements and the buyer total. Stores nothing. */
export const previewTrade = defineEndpoint({
  method: 'post',
  path: '/trades/preview',
  scope: 'CONSUMER',
  retryable: false,
  schema: {
    body: z.object({
      role: tradeRoleSchema,
      categoryCode: z.string().min(1).max(60),
      itemAmountMinor: koboJsonSchema.optional(),
    }),
    response: previewResponseSchema,
  },
});

export const createTrade = defineEndpoint({
  method: 'post',
  path: '/trades',
  scope: 'CONSUMER',
  retryable: true,
  schema: {
    body: z.object({
      role: tradeRoleSchema,
      categoryCode: z.string().min(1).max(60),
      itemAmountMinor: koboJsonSchema,
      itemSpec,
      /** The saved address for the initiator's own side: delivery for a buyer, ships-from for a seller. */
      addressId: z.uuid(),
      proofFileIds: proofFileIds.optional(),
    }),
    response: tradeViewSchema,
  },
});

export const getTrade = defineEndpoint({
  method: 'get',
  path: '/trades/:id',
  scope: 'CONSUMER',
  schema: { params: tradeParams, response: tradeViewSchema },
});

/** Exactly one of `username`, `email` or `phone` names the other party. */
export const sendTrade = defineEndpoint({
  method: 'post',
  path: '/trades/:id/send',
  scope: 'CONSUMER',
  retryable: true,
  schema: {
    params: tradeParams,
    body: z.object({
      username: z.string().min(1).max(40).optional(),
      email: z.string().min(3).max(254).optional(),
      phone: z.string().min(5).max(20).optional(),
      proofFileIds: proofFileIds.optional(),
    }),
    response: tradeViewSchema,
  },
});

/** A new terms version; `expectedRevision` is the `statusRevision` the person was looking at. */
export const counterTrade = defineEndpoint({
  method: 'post',
  path: '/trades/:id/counter',
  scope: 'CONSUMER',
  retryable: true,
  schema: {
    params: tradeParams,
    body: z.object({
      expectedRevision: z.int().min(0),
      itemAmountMinor: koboJsonSchema.optional(),
      itemSpec: itemSpec.optional(),
      addressId: z.uuid().optional(),
      proofFileIds: proofFileIds.optional(),
    }),
    response: tradeViewSchema,
  },
});

/** Accepts the version on screen (`termsVersionId`), so a counter that arrived meanwhile is not accepted blind. */
export const acceptTrade = defineEndpoint({
  method: 'post',
  path: '/trades/:id/accept',
  scope: 'CONSUMER',
  retryable: true,
  schema: {
    params: tradeParams,
    body: z.object({
      termsVersionId: z.uuid(),
      addressId: z.uuid().optional(),
      proofFileIds: proofFileIds.optional(),
    }),
    response: tradeViewSchema,
  },
});

export const declineTrade = defineEndpoint({
  method: 'post',
  path: '/trades/:id/decline',
  scope: 'CONSUMER',
  retryable: true,
  schema: {
    params: tradeParams,
    body: z.object({ reason: z.string().trim().min(3).max(500) }),
    response: tradeViewSchema,
  },
});

export const cancelTrade = defineEndpoint({
  method: 'post',
  path: '/trades/:id/cancel',
  scope: 'CONSUMER',
  retryable: true,
  schema: {
    params: tradeParams,
    body: z.object({ reason: z.string().trim().min(1).max(500).optional() }),
    response: tradeViewSchema,
  },
});

/** The holder of a claimed invitation takes their side of the trade. */
export const claimTrade = defineEndpoint({
  method: 'post',
  path: '/trades/:id/claim',
  scope: 'CONSUMER',
  retryable: true,
  schema: { params: tradeParams, response: tradeViewSchema },
});

/**
 * The caller's trades, newest-relevant first. `cursor` is passed back exactly as received; a 422 means
 * the filter changed or the cursor was mangled, and the answer is to start again from page one.
 */
export const listTrades = defineEndpoint({
  method: 'get',
  path: '/trades',
  scope: 'CONSUMER',
  paginated: 'cursor',
  schema: {
    query: cursorPageRequestSchema.extend({ state: tradeListStateSchema.optional() }),
    response: tradeListResponseSchema,
  },
});

/**
 * Opens a trade from its code for a party or the named invitee. Anyone else gets the same 404 as a code
 * that does not exist. Ten tries a minute, so it is never retried automatically.
 */
export const getTradeByCode = defineEndpoint({
  method: 'get',
  path: '/trades/by-code/:code',
  scope: 'CONSUMER',
  schema: { params: z.object({ code: canonicalTradeCodeSchema }), response: tradeByCodeResponseSchema },
});

/**
 * A trade's history as a party may read it: labels, who, and when, never free text. Cursor-paginated, newest
 * first. A 422 means the cursor was mangled or belongs to another trade: start again from page one.
 */
export const listTradeActivity = defineEndpoint({
  method: 'get',
  path: '/trades/:id/activity',
  scope: 'CONSUMER',
  paginated: 'cursor',
  schema: { params: tradeParams, query: cursorPageRequestSchema, response: tradeActivityResponseSchema },
});

/** The delivery deadline and any request for more time on it, for either party (DE1 to DE3). */
export const getDeliveryDeadline = defineEndpoint({
  method: 'get',
  path: '/trades/:id/delivery-deadline',
  scope: 'CONSUMER',
  schema: {
    params: tradeParams,
    response: z.looseObject({
      deadline: z
        .looseObject({ id: z.uuid(), status: z.string(), dueAt: z.string(), extensionCount: z.number() })
        .nullable(),
      extensionRequest: z
        .looseObject({
          id: z.uuid(),
          status: z.string(),
          reason: z.string().optional(),
          note: z.string().nullable().optional(),
          currentDueAt: z.string(),
          requestedDueAt: z.string(),
        })
        .nullable(),
    }),
  },
});

/** BEI1/BEI2: a request for more inspection time, as the platform reports it. */
export const inspectionExtensionSchema = z.looseObject({
  id: z.uuid(),
  status: z.string(),
  extraHours: z.number().optional(),
  note: z.string().nullable().optional(),
  currentDueAt: z.string().optional(),
  requestedDueAt: z.string().optional(),
});
export type InspectionExtension = z.infer<typeof inspectionExtensionSchema>;

/**
 * The inspection window, whether more time can be asked for or answered, the seller's proof beside the delivery
 * evidence (Z4), and the one sentence the buyer acknowledges before releasing (Z5). Proof and evidence are empty
 * until the trade has shipped.
 */
export const getInspection = defineEndpoint({
  method: 'get',
  path: '/trades/:id/inspection',
  scope: 'CONSUMER',
  schema: {
    params: tradeParams,
    response: z.looseObject({
      status: z.string(),
      yourRole: tradeRoleSchema,
      window: z.looseObject({
        hours: z.number(),
        startedAt: z.string().nullable(),
        deadlineAt: z.string().nullable(),
        extended: z.boolean(),
        autoReleasePaused: z.boolean(),
      }),
      extensionRequest: inspectionExtensionSchema.nullable(),
      canRequestMoreTime: z.boolean(),
      canRespondToRequest: z.boolean(),
      sellerProof: z
        .looseObject({
          media: z.array(z.looseObject({ fileId: z.uuid(), attachedAt: z.string().optional() })),
        })
        .optional(),
      deliveryEvidence: z.looseObject({
        signals: z.array(z.looseObject({ source: z.string(), reportedAt: z.string().optional() })).optional(),
        selfArranged: z
          .looseObject({
            waybillNumber: z.string(),
            shippedAt: z.string(),
            receiptFileId: z.uuid().optional(),
            vehiclePlate: z.string().optional(),
            driverPhone: z.string().optional(),
          })
          .nullable(),
      }),
      release: z
        .looseObject({ acknowledgement: z.string(), acknowledgedAt: z.string().nullable().optional() })
        .optional(),
    }),
  },
});

/** BEI1: the buyer asks the seller for more inspection time, once. Whole hours; the platform holds the ceiling. */
export const requestInspectionExtension = defineEndpoint({
  method: 'post',
  path: '/trades/:id/inspection-extension',
  scope: 'CONSUMER',
  retryable: true,
  schema: {
    params: tradeParams,
    body: z.object({
      extraHours: z.number().int().min(1),
      note: z.string().trim().min(1).max(500).optional(),
    }),
    response: inspectionExtensionSchema,
  },
});

const extensionRequestParams = z.object({ id: z.uuid(), requestId: z.uuid() });

/** BEI2: the seller agrees; the deadline moves. */
export const acceptInspectionExtension = defineEndpoint({
  method: 'post',
  path: '/trades/:id/inspection-extension/:requestId/accept',
  scope: 'CONSUMER',
  retryable: true,
  schema: { params: extensionRequestParams, response: inspectionExtensionSchema },
});

/** BEI2: the seller declines; the original deadline stands. */
export const declineInspectionExtension = defineEndpoint({
  method: 'post',
  path: '/trades/:id/inspection-extension/:requestId/decline',
  scope: 'CONSUMER',
  retryable: true,
  schema: { params: extensionRequestParams, response: inspectionExtensionSchema },
});

/**
 * Z5: the buyer confirms the item and releases the payment. Final, so it carries the explicit acknowledgement
 * (the literal `true`, nothing else counts). Answers with the trade, now completed.
 */
export const acceptInspection = defineEndpoint({
  method: 'post',
  path: '/trades/:id/accept-inspection',
  scope: 'CONSUMER',
  retryable: true,
  schema: {
    params: tradeParams,
    body: z.object({ acknowledged: z.literal(true) }),
    response: tradeViewSchema,
  },
});
