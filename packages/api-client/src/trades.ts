// The proposal half of a trade (T-060, T-061): preview, create a draft, send it, and the answers the
// other party gives. Mirrors `apps/backend-api/src/modules/trades/http/trade.routes.ts` field for field.
//
// Money is a digit string of kobo on the wire, both ways. A screen formats it with `formatNaira` and
// never adds, subtracts or multiplies it: the fee lines and totals come from the trade's own snapshot.
import { koboJsonSchema } from '@komtru/shared-types';
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
