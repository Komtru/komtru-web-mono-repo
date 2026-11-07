// T-072's buyer-facing funding routes (M8 §11):
//
//   POST /trades/:code/payment/initiate   a payment attempt and what Paystack Inline needs (V1, V2)
//   POST /trades/:code/payment/confirm    Inline's success callback, and AB4's "check again"
//   GET  /trades/:code/payment/status     AB3, AB4 and V3, derived from the attempt
//
// The mutating two take an idempotency key; each is also a no-op on a repeat by itself.
import { requireUserId, type Actor } from '../../../platform/http/principal.js';
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import {
  confirmFunding,
  initiateFunding,
  paymentStatus,
  type ChargeDeps,
} from '../services/charge.service.js';
import {
  initiateBodySchema,
  initiatedPaymentSchema,
  paymentStatusViewSchema,
  tradeCodeParamSchema,
} from './payment.validation.js';

const SIGN_IN = 'Sign in to pay';
const me = (actor: Actor): string => requireUserId(actor, SIGN_IN);
const PAY_BUDGET = { points: 20, durationSeconds: 60, by: ['user', 'ip'] as ('user' | 'ip')[] };

export function paymentRoutes(deps: () => ChargeDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'post',
      path: '/trades/:code/payment/initiate',
      scope: 'CONSUMER',
      summary: 'Start paying for a trade: a payment attempt and the Paystack Inline setup',
      retryable: true,
      rateLimit: { ...PAY_BUDGET },
      schema: { params: tradeCodeParamSchema, body: initiateBodySchema, response: initiatedPaymentSchema },
      handler: (ctx) =>
        initiateFunding(deps(), {
          userId: me(ctx.actor),
          trade: ctx.params.code,
          ...(ctx.body.restart === undefined ? {} : { restart: ctx.body.restart }),
        }),
    }),

    defineRoute({
      method: 'post',
      path: '/trades/:code/payment/confirm',
      scope: 'CONSUMER',
      summary: 'Tell us the checkout finished; the payment is verified with the provider',
      retryable: true,
      rateLimit: { ...PAY_BUDGET },
      schema: { params: tradeCodeParamSchema, response: paymentStatusViewSchema },
      handler: (ctx) => confirmFunding(deps(), { userId: me(ctx.actor), trade: ctx.params.code }),
    }),

    defineRoute({
      method: 'get',
      path: '/trades/:code/payment/status',
      scope: 'CONSUMER',
      summary: "A trade's payment state, as its buyer sees it",
      schema: { params: tradeCodeParamSchema, response: paymentStatusViewSchema },
      handler: (ctx) => paymentStatus(deps(), { userId: me(ctx.actor), trade: ctx.params.code }),
    }),
  ];
}
