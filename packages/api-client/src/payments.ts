// Funding a trade (T-072, F-024): start a payment, say the checkout finished, and read where it stands.
// Mirrors `apps/backend-api/src/modules/ledger/http/payment.validation.ts` field for field.
//
// Money is a digit string of kobo, as everywhere else, with ONE exception the platform makes on purpose:
// `inline.amount` is the number Paystack Inline itself takes, and it is handed to Paystack untouched. A screen
// never adds the fee to the item, or works out a percentage: every line comes from the trade's snapshot or the
// attempt, as the platform sent it.
import { z } from 'zod';
import { defineEndpoint } from './contracts.js';

/** `:code` takes the trade code or the trade's id; this client always sends the id. */
const tradeParams = z.object({ code: z.uuid() });
const kobo = z.string().regex(/^\d{1,19}$/);

/**
 * Where a payment stands, as its buyer sees it (T-072's `paymentDisplayState`). Each one is a screen:
 * `NONE` and `AWAITING_PAYMENT` are V1/V2, `VERIFYING` is AB3, `NOT_CONFIRMED` is AB4, `CONFIRMED` is V3, and
 * `UNDER_REVIEW` is money that arrived but did not match, held for the team.
 */
export const PAYMENT_DISPLAY_STATES = [
  'NONE',
  'AWAITING_PAYMENT',
  'VERIFYING',
  'CONFIRMED',
  'NOT_CONFIRMED',
  'UNDER_REVIEW',
] as const;
export type PaymentDisplayState = (typeof PAYMENT_DISPLAY_STATES)[number];

export const paymentAttemptSchema = z.looseObject({
  id: z.uuid(),
  /** OUR reference (`fund-<attempt id>`), the one Paystack and support both know the payment by. */
  reference: z.string(),
  status: z.string(),
  displayState: z.enum(PAYMENT_DISPLAY_STATES),
  currency: z.string(),
  /** What the buyer is charged: the trade's snapshotted item plus buyer protection fee. */
  amountMinor: kobo,
  itemAmountMinor: kobo,
  buyerProtectionFeeMinor: kobo,
  initiatedAt: z.string(),
  confirmedAt: z.string().nullable(),
});
export type PaymentAttempt = z.infer<typeof paymentAttemptSchema>;

export const paymentStatusSchema = z.looseObject({
  tradeId: z.uuid(),
  tradeCode: z.string(),
  displayState: z.enum(PAYMENT_DISPLAY_STATES),
  attempt: paymentAttemptSchema.nullable(),
});
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

/** What Paystack Inline needs, exactly as the platform issued it. */
export const paystackInlineSchema = z.looseObject({
  key: z.string(),
  email: z.string(),
  amount: z.number().int().positive(),
  currency: z.string(),
  reference: z.string(),
  channels: z.array(z.string()),
});
export type PaystackInline = z.infer<typeof paystackInlineSchema>;

export const initiatedPaymentSchema = paymentStatusSchema.extend({
  attempt: paymentAttemptSchema,
  inline: paystackInlineSchema,
});
export type InitiatedPayment = z.infer<typeof initiatedPaymentSchema>;

/**
 * A payment attempt and the Inline setup. A repeat returns the open attempt; `restart: true` abandons an open
 * attempt nobody is paying on and issues a new reference, within the platform's grace rules (409 otherwise).
 */
export const initiatePayment = defineEndpoint({
  method: 'post',
  path: '/trades/:code/payment/initiate',
  scope: 'CONSUMER',
  retryable: true,
  schema: {
    params: tradeParams,
    body: z.object({ restart: z.boolean().optional() }),
    response: initiatedPaymentSchema,
  },
});

/** Inline's success callback, and AB4's "check again": the platform verifies with Paystack; it believes nothing. */
export const confirmPayment = defineEndpoint({
  method: 'post',
  path: '/trades/:code/payment/confirm',
  scope: 'CONSUMER',
  retryable: true,
  schema: { params: tradeParams, response: paymentStatusSchema },
});

export const getPaymentStatus = defineEndpoint({
  method: 'get',
  path: '/trades/:code/payment/status',
  scope: 'CONSUMER',
  schema: { params: tradeParams, response: paymentStatusSchema },
});
