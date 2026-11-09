// The funding routes' wire shapes. Money leaves as digit-string kobo, never a JSON number, except
// the one number Paystack Inline itself takes (checked exact by the service).
import { tradeCodeSchema } from '@komtru/shared-types';
import { z } from 'zod';
import type { TradeRef } from '../infrastructure/postgres/tradeFunding.js';

/** `:code` takes the trade code the buyer sees (`KMT-7398512-NG`) or the trade's id. */
export const tradeCodeParamSchema = z.object({
  code: z.union([
    z.uuid().transform((tradeId): TradeRef => ({ tradeId: tradeId.toLowerCase() })),
    tradeCodeSchema.transform((tradeCode): TradeRef => ({ tradeCode })),
  ]),
});

export const initiateBodySchema = z
  .strictObject({ restart: z.boolean().optional() })
  .optional()
  .transform((body) => body ?? {});

const kobo = z.string().regex(/^\d{1,19}$/);
const displayState = z.enum([
  'NONE',
  'AWAITING_PAYMENT',
  'VERIFYING',
  'CONFIRMED',
  'NOT_CONFIRMED',
  'UNDER_REVIEW',
]);

export const paymentAttemptViewSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  status: z.string(),
  displayState,
  currency: z.string(),
  amountMinor: kobo,
  itemAmountMinor: kobo,
  buyerProtectionFeeMinor: kobo,
  initiatedAt: z.string(),
  confirmedAt: z.string().nullable(),
});

export const paymentStatusViewSchema = z.object({
  tradeId: z.uuid(),
  tradeCode: z.string(),
  displayState,
  attempt: paymentAttemptViewSchema.nullable(),
});

export const initiatedPaymentSchema = paymentStatusViewSchema.extend({
  attempt: paymentAttemptViewSchema,
  inline: z.object({
    key: z.string(),
    email: z.string(),
    amount: z.number().int().positive(),
    currency: z.string(),
    reference: z.string(),
    channels: z.array(z.string()),
  }),
});

export const webhookAckSchema = z.object({ received: z.literal(true) });
