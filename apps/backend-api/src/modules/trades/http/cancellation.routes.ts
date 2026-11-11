// T-066's routes (design §6.2, M7 D3): cancelling a funded trade before it ships.
//
//   GET  /trades/:id/cancellation                                  CR1–CR3, SC1, SC2: the request and what you may do
//   POST /trades/:id/cancellation-request                          CR1: the buyer asks the seller to cancel
//   POST /trades/:id/cancellation-request/:requestId/approve       CR2: the seller agrees; a full refund is requested
//   POST /trades/:id/cancellation-request/:requestId/decline       CR2: the seller declines ("contest")
//   POST /trades/:id/cannot-fulfil                                 SC1: the seller cancels; the buyer is refunded
//
// Cancelling before funding is still `POST /trades/:id/cancel` (CT1). The refund's amount and progress
// are the ledger's: `GET /trades/:id/refunds`.
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import { requireUserId, type Actor } from '../../../platform/http/principal.js';
import {
  cancelAsSeller,
  getCancellation,
  requestCancellation,
  respondToCancellation,
} from '../services/cancellation.service.js';
import type { FulfilmentDeps } from '../services/fulfilmentPorts.js';
import {
  cancellationRequestBodySchema,
  cancellationRequestParamSchema,
  cancellationRequestResponseSchema,
  cancellationResponseBodySchema,
  cancellationViewSchema,
  cannotFulfilBodySchema,
} from './cancellation.validation.js';
import { tradeIdParamSchema } from './trade.validation.js';

const SIGN_IN = 'Sign in to trade';
const ACTION_BUDGET = { points: 30, durationSeconds: 60, by: ['user', 'ip'] as ('user' | 'ip')[] };
const me = (actor: Actor): string => requireUserId(actor, SIGN_IN);

export function cancellationRoutes(deps: () => FulfilmentDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'get',
      path: '/trades/:id/cancellation',
      scope: 'CONSUMER',
      summary: "A funded trade's cancellation request, and what you may do about it",
      schema: { params: tradeIdParamSchema, response: cancellationViewSchema },
      handler: (ctx) => getCancellation(deps(), { userId: me(ctx.actor), tradeId: ctx.params.id }),
    }),

    defineRoute({
      method: 'post',
      path: '/trades/:id/cancellation-request',
      scope: 'CONSUMER',
      summary: 'The buyer asks the seller to cancel a funded trade before it ships',
      status: 201,
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: {
        params: tradeIdParamSchema,
        body: cancellationRequestBodySchema,
        response: cancellationRequestResponseSchema,
      },
      handler: (ctx) =>
        requestCancellation(deps(), {
          userId: me(ctx.actor),
          tradeId: ctx.params.id,
          reason: ctx.body.reason,
          ...(ctx.body.note ? { note: ctx.body.note } : {}),
        }),
    }),

    defineRoute({
      method: 'post',
      path: '/trades/:id/cancellation-request/:requestId/approve',
      scope: 'CONSUMER',
      summary: 'The seller agrees to cancel; the buyer is refunded in full',
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: {
        params: cancellationRequestParamSchema,
        body: cancellationResponseBodySchema,
        response: cancellationRequestResponseSchema,
      },
      handler: (ctx) =>
        respondToCancellation(deps(), {
          userId: me(ctx.actor),
          tradeId: ctx.params.id,
          requestId: ctx.params.requestId,
          decision: 'APPROVE',
          ...(ctx.body.note ? { note: ctx.body.note } : {}),
        }),
    }),

    defineRoute({
      method: 'post',
      path: '/trades/:id/cancellation-request/:requestId/decline',
      scope: 'CONSUMER',
      summary: 'The seller declines to cancel',
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: {
        params: cancellationRequestParamSchema,
        body: cancellationResponseBodySchema,
        response: cancellationRequestResponseSchema,
      },
      handler: (ctx) =>
        respondToCancellation(deps(), {
          userId: me(ctx.actor),
          tradeId: ctx.params.id,
          requestId: ctx.params.requestId,
          decision: 'DECLINE',
          ...(ctx.body.note ? { note: ctx.body.note } : {}),
        }),
    }),

    defineRoute({
      method: 'post',
      path: '/trades/:id/cannot-fulfil',
      scope: 'CONSUMER',
      summary: 'The seller cannot fulfil a funded trade; the buyer is refunded in full',
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: {
        params: tradeIdParamSchema,
        body: cannotFulfilBodySchema,
        response: cancellationRequestResponseSchema,
      },
      handler: (ctx) =>
        cancelAsSeller(deps(), {
          userId: me(ctx.actor),
          tradeId: ctx.params.id,
          reason: ctx.body.reason,
          ...(ctx.body.note ? { note: ctx.body.note } : {}),
        }),
    }),
  ];
}
