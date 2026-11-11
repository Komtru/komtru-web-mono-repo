// Cancelling a funded trade and getting a refund (T-066, T-075, F-030): the cancellation request and its
// answer, the seller's can't-fulfil, and the refunds the ledger decided. Mirrors
// `apps/backend-api/src/modules/trades/http/cancellation.{routes,validation}.ts` and
// `apps/backend-api/src/modules/ledger/http/refundRoutes.ts`, for the screens T-119 builds (CR1–CR3, SC1, SC2).
//
// Cancelling BEFORE funding is still `cancelTrade` (CT1, in trades.ts): it is a plain status change. After
// funding a trade is never cancelled, only refunded (M7 D3), and no client ever names an amount or a charge:
// the ledger decides the refund from the trade's own snapshot, against the trade's own payment.
//
// Money is a digit string of kobo. A screen never computes the refund: `amountMinor` is what goes back to the
// buyer's payment method, `feeAmountMinor` the buyer protection fee returned with it.
//
// Refusals a screen branches on, by the problem's `reason` extension (409): `NOT_FUNDED` (shipped already, or
// not paid yet), `TRADE_HELD`, `REFUND_ALREADY_REQUESTED`, `CANCELLATION_ALREADY_PENDING`,
// `CANCELLATION_ALREADY_ANSWERED`, `CANCELLATION_LAPSED`.
import {
  BUYER_CANCELLATION_REASONS,
  CANCELLATION_REQUEST_STATUSES,
  REFUND_FEE_TREATMENTS,
  REFUND_SCOPES,
  REFUND_STATUSES,
  SELLER_CANCELLATION_REASONS,
  cursorPageRequestSchema,
  paginatedSchema,
} from '@komtru/shared-types';
import { z } from 'zod';
import { defineEndpoint } from './contracts.js';

export {
  BUYER_CANCELLATION_REASONS,
  CANCELLATION_REQUEST_STATUSES,
  REFUND_FEE_TREATMENTS,
  REFUND_SCOPES,
  REFUND_STATUSES,
  SELLER_CANCELLATION_REASONS,
};

const kobo = z.string().regex(/^\d{1,19}$/);
const tradeParams = z.object({ id: z.uuid() });
const requestParams = z.object({ id: z.uuid(), requestId: z.uuid() });
const note = z.string().min(1).max(500).optional();

export const cancellationRequestSchema = z.looseObject({
  id: z.uuid(),
  /** BUYER for a request (CR1), SELLER for a can't-fulfil (SC1). */
  requestedByRole: z.enum(['BUYER', 'SELLER']),
  reason: z.enum([...BUYER_CANCELLATION_REASONS, ...SELLER_CANCELLATION_REASONS]),
  note: z.string().nullable(),
  status: z.enum(CANCELLATION_REQUEST_STATUSES),
  responseNote: z.string().nullable(),
  respondedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type CancellationRequest = z.infer<typeof cancellationRequestSchema>;

export const cancellationSchema = z.looseObject({
  tradeId: z.uuid(),
  tradeStatus: z.string(),
  yourRole: z.enum(['BUYER', 'SELLER']),
  /** The latest request on the trade, or null. */
  request: cancellationRequestSchema.nullable(),
  /** A refund has been asked for (approved, can't-fulfil, overdue delivery) or the trade is already refunded. */
  refundRequested: z.boolean(),
  /** What the reader may do now. Decided by the platform: a screen shows the button only when it is true. */
  actions: z.looseObject({
    /** CR1: the buyer, on a FUNDED trade with no request yet. */
    canRequest: z.boolean(),
    /** CR2: the seller, while the buyer's request is PENDING. */
    canRespond: z.boolean(),
    /** SC1: the seller, on a FUNDED trade. */
    canCancelAsSeller: z.boolean(),
  }),
});
export type Cancellation = z.infer<typeof cancellationSchema>;

export const refundSchema = z.looseObject({
  id: z.uuid(),
  tradeId: z.uuid(),
  /** OUR reference (`refund-<id>`): what support knows the refund by. */
  reference: z.string(),
  status: z.enum(REFUND_STATUSES),
  scope: z.enum(REFUND_SCOPES),
  /** MUTUAL_AGREEMENT, SELLER_CANNOT_FULFIL, DELIVERY_OVERDUE, … */
  reason: z.string(),
  currency: z.string(),
  itemAmountMinor: kobo,
  feeAmountMinor: kobo,
  /** What goes back to the buyer's original payment method. */
  amountMinor: kobo,
  buyerProtectionFeeTreatment: z.enum(REFUND_FEE_TREATMENTS),
  /** FAILED or NEEDS_REVIEW: why, in words a buyer can read. The money is held, not lost. */
  failureReason: z.string().nullable(),
  requestedAt: z.string(),
  completedAt: z.string().nullable(),
  failedAt: z.string().nullable(),
});
export type Refund = z.infer<typeof refundSchema>;

/** CR1–CR3, SC1, SC2: the cancellation request on a trade and what the reader may do about it. */
export const getCancellation = defineEndpoint({
  method: 'get',
  path: '/trades/:id/cancellation',
  scope: 'CONSUMER',
  schema: { params: tradeParams, response: cancellationSchema },
});

/** CR1: the buyer asks the seller to cancel a FUNDED trade before it ships. 201 with the request. */
export const requestCancellation = defineEndpoint({
  method: 'post',
  path: '/trades/:id/cancellation-request',
  scope: 'CONSUMER',
  retryable: true,
  schema: {
    params: tradeParams,
    body: z.object({ reason: z.enum(BUYER_CANCELLATION_REASONS), note }),
    response: cancellationRequestSchema,
  },
});

/** CR2: the seller agrees. The buyer is refunded in full, automatically. */
export const approveCancellation = defineEndpoint({
  method: 'post',
  path: '/trades/:id/cancellation-request/:requestId/approve',
  scope: 'CONSUMER',
  retryable: true,
  schema: { params: requestParams, body: z.object({ note }), response: cancellationRequestSchema },
});

/** CR2: the seller declines (the reference's "contest — I've already shipped"). */
export const declineCancellation = defineEndpoint({
  method: 'post',
  path: '/trades/:id/cancellation-request/:requestId/decline',
  scope: 'CONSUMER',
  retryable: true,
  schema: { params: requestParams, body: z.object({ note }), response: cancellationRequestSchema },
});

/** SC1: the seller cannot fulfil a FUNDED trade. No review step: the buyer is refunded in full (SC2). */
export const cancelAsSeller = defineEndpoint({
  method: 'post',
  path: '/trades/:id/cannot-fulfil',
  scope: 'CONSUMER',
  retryable: true,
  schema: {
    params: tradeParams,
    body: z.object({ reason: z.enum(SELLER_CANCELLATION_REASONS), note }),
    response: cancellationRequestSchema,
  },
});

/** CR3, SC2: the trade's refunds, newest first, for either party. */
export const listTradeRefunds = defineEndpoint({
  method: 'get',
  path: '/trades/:id/refunds',
  scope: 'CONSUMER',
  schema: { params: tradeParams, response: z.looseObject({ refunds: z.array(refundSchema) }) },
});

/** The caller's refunds as a buyer, newest first. */
export const listMyRefunds = defineEndpoint({
  method: 'get',
  path: '/me/refunds',
  scope: 'CONSUMER',
  paginated: 'cursor',
  schema: { query: cursorPageRequestSchema, response: paginatedSchema(refundSchema) },
});

/** REQUESTED and PROCESSING are on their way; every other status is the platform's settled answer. */
export const isRefundInFlight = (refund: Pick<Refund, 'status'>): boolean =>
  refund.status === 'REQUESTED' || refund.status === 'PROCESSING';
