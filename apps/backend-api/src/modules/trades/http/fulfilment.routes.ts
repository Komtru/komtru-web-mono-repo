// T-064's routes (design §6.2, M7, m2 §10):
//
//   GET  /trades/:id/ship-options                              X2: what the seller may choose, computed here
//   POST /trades/:id/ship/self-arranged                        X2: waybill, receipt photo, driver phone and plate
//   POST /trades/:id/confirm-delivery                          the buyer has it (INSPECTION)
//   POST /trades/:id/report-delivered                          the seller says it arrived (UNCONFIRMED_DELIVERY)
//   GET  /trades/:id/delivery-deadline                         DE1/DE2/DE3: the deadline and its extension request
//   POST /trades/:id/delivery-extension                        DE1: the seller asks for more time
//   POST /trades/:id/delivery-extension/:requestId/accept      DE2: the buyer agrees to the new date
//   POST /trades/:id/delivery-extension/:requestId/decline     DE2: the buyer declines
//
// SEAM(T-087): `POST /trades/:code/ship/company`, and SEAM(T-093): the Park branch, are added by
// those tickets. Both start with `assertDispatchOpen` from the fulfilment service, so the X1 guard
// is the same on every shipping endpoint.
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import { requireUserId, type Actor } from '../../../platform/http/principal.js';
import { confirmDelivery, reportDelivered } from '../services/deliverySignal.service.js';
import { getDeliveryDeadline, requestExtension, respondToExtension } from '../services/deadline.service.js';
import type { FulfilmentDeps } from '../services/fulfilmentPorts.js';
import { getShipOptions, shipSelfArranged } from '../services/fulfilment.service.js';
import {
  deliveryDeadlineResponseSchema,
  extensionBodySchema,
  extensionParamSchema,
  extensionResponseSchema,
  selfArrangedBodySchema,
  shipOptionsResponseSchema,
} from './fulfilment.validation.js';
import { tradeIdParamSchema, tradeViewSchema } from './trade.validation.js';

const SIGN_IN = 'Sign in to trade';
const ACTION_BUDGET = { points: 30, durationSeconds: 60, by: ['user', 'ip'] as ('user' | 'ip')[] };
const me = (actor: Actor): string => requireUserId(actor, SIGN_IN);

export function fulfilmentRoutes(deps: () => FulfilmentDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'get',
      path: '/trades/:id/ship-options',
      scope: 'CONSUMER',
      summary: 'The ways the seller can ship this trade, with Park pinned first',
      schema: { params: tradeIdParamSchema, response: shipOptionsResponseSchema },
      handler: (ctx) => getShipOptions(deps(), { userId: me(ctx.actor), tradeId: ctx.params.id }),
    }),

    defineRoute({
      method: 'post',
      path: '/trades/:id/ship/self-arranged',
      scope: 'CONSUMER',
      summary: 'Mark a trade shipped with your own arrangement, with waybill evidence',
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: { params: tradeIdParamSchema, body: selfArrangedBodySchema, response: tradeViewSchema },
      handler: (ctx) =>
        shipSelfArranged(deps(), { userId: me(ctx.actor), tradeId: ctx.params.id, shipment: ctx.body }),
    }),

    defineRoute({
      method: 'post',
      path: '/trades/:id/confirm-delivery',
      scope: 'CONSUMER',
      summary: 'The buyer confirms they received the item; inspection starts',
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: { params: tradeIdParamSchema, response: tradeViewSchema },
      handler: (ctx) => confirmDelivery(deps(), { userId: me(ctx.actor), tradeId: ctx.params.id }),
    }),

    defineRoute({
      method: 'post',
      path: '/trades/:id/report-delivered',
      scope: 'CONSUMER',
      summary: 'The seller reports the item was delivered; the buyer is asked to confirm',
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: { params: tradeIdParamSchema, response: tradeViewSchema },
      handler: (ctx) => reportDelivered(deps(), { userId: me(ctx.actor), tradeId: ctx.params.id }),
    }),

    defineRoute({
      method: 'get',
      path: '/trades/:id/delivery-deadline',
      scope: 'CONSUMER',
      summary: "The trade's delivery deadline and any request for more time",
      schema: { params: tradeIdParamSchema, response: deliveryDeadlineResponseSchema },
      handler: (ctx) => getDeliveryDeadline(deps(), { userId: me(ctx.actor), tradeId: ctx.params.id }),
    }),

    defineRoute({
      method: 'post',
      path: '/trades/:id/delivery-extension',
      scope: 'CONSUMER',
      summary: 'The seller asks the buyer for more time to deliver',
      status: 201,
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: { params: tradeIdParamSchema, body: extensionBodySchema, response: extensionResponseSchema },
      handler: (ctx) =>
        requestExtension(deps(), {
          userId: me(ctx.actor),
          tradeId: ctx.params.id,
          reason: ctx.body.reason,
          requestedDueAt: ctx.body.requestedDueAt,
          ...(ctx.body.note ? { note: ctx.body.note } : {}),
        }),
    }),

    defineRoute({
      method: 'post',
      path: '/trades/:id/delivery-extension/:requestId/accept',
      scope: 'CONSUMER',
      summary: 'The buyer agrees to the new delivery date',
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: { params: extensionParamSchema, response: extensionResponseSchema },
      handler: (ctx) =>
        respondToExtension(deps(), {
          userId: me(ctx.actor),
          tradeId: ctx.params.id,
          requestId: ctx.params.requestId,
          decision: 'ACCEPT',
        }),
    }),

    defineRoute({
      method: 'post',
      path: '/trades/:id/delivery-extension/:requestId/decline',
      scope: 'CONSUMER',
      summary: 'The buyer declines the request for more time',
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: { params: extensionParamSchema, response: extensionResponseSchema },
      handler: (ctx) =>
        respondToExtension(deps(), {
          userId: me(ctx.actor),
          tradeId: ctx.params.id,
          requestId: ctx.params.requestId,
          decision: 'DECLINE',
        }),
    }),
  ];
}
