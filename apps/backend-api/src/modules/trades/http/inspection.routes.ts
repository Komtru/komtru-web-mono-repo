// T-065's routes (design §6.2, M7 §9, HTML BEI1/BEI2/Z4/Z5):
//
//   GET  /trades/:id/inspection                                   Z4: seller proof beside the delivery evidence
//   POST /trades/:id/inspection-extension                         BEI1: the buyer asks for more time, once
//   POST /trades/:id/inspection-extension/:requestId/accept       BEI2: the seller agrees
//   POST /trades/:id/inspection-extension/:requestId/decline      BEI2: the seller declines
//   POST /trades/:id/accept-inspection                            Z5: confirm and release, acknowledged
//
// `accept-inspection` is M7 §9's name for INSPECTION -> COMPLETED, buyer-initiated. There is no
// route that completes a trade for the seller or for staff: AR1 is the job's, never a request's.
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import { requireUserId, type Actor } from '../../../platform/http/principal.js';
import { confirmReleaseBodySchema } from '../domain/inspection.js';
import {
  confirmAndRelease,
  getInspection,
  requestInspectionExtension,
  respondToInspectionExtension,
} from '../services/inspection.service.js';
import type { InspectionDeps } from '../services/inspectionPorts.js';
import { tradeIdParamSchema, tradeViewSchema } from './trade.validation.js';
import {
  inspectionExtensionBodySchema,
  inspectionExtensionParamSchema,
  inspectionExtensionResponseSchema,
  inspectionResponseSchema,
} from './inspection.validation.js';

const SIGN_IN = 'Sign in to trade';
const ACTION_BUDGET = { points: 30, durationSeconds: 60, by: ['user', 'ip'] as ('user' | 'ip')[] };
const me = (actor: Actor): string => requireUserId(actor, SIGN_IN);

export function inspectionRoutes(deps: () => InspectionDeps): RouteDefinition[] {
  const answer = (decision: 'ACCEPT' | 'DECLINE') => ({
    method: 'post' as const,
    scope: 'CONSUMER' as const,
    retryable: true,
    rateLimit: { ...ACTION_BUDGET },
    schema: { params: inspectionExtensionParamSchema, response: inspectionExtensionResponseSchema },
    handler: (ctx: { actor: Actor; params: { id: string; requestId: string } }) =>
      respondToInspectionExtension(deps(), {
        userId: me(ctx.actor),
        tradeId: ctx.params.id,
        requestId: ctx.params.requestId,
        decision,
      }),
  });

  return [
    defineRoute({
      method: 'get',
      path: '/trades/:id/inspection',
      scope: 'CONSUMER',
      summary: "Compare the seller's proof with the delivery evidence, and see the inspection window",
      schema: { params: tradeIdParamSchema, response: inspectionResponseSchema },
      handler: (ctx) => getInspection(deps(), { userId: me(ctx.actor), tradeId: ctx.params.id }),
    }),

    defineRoute({
      method: 'post',
      path: '/trades/:id/inspection-extension',
      scope: 'CONSUMER',
      summary: 'The buyer asks the seller for more inspection time (once)',
      status: 201,
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: {
        params: tradeIdParamSchema,
        body: inspectionExtensionBodySchema,
        response: inspectionExtensionResponseSchema,
      },
      handler: (ctx) =>
        requestInspectionExtension(deps(), {
          userId: me(ctx.actor),
          tradeId: ctx.params.id,
          extraHours: ctx.body.extraHours,
          ...(ctx.body.note ? { note: ctx.body.note } : {}),
        }),
    }),

    defineRoute({
      ...answer('ACCEPT'),
      path: '/trades/:id/inspection-extension/:requestId/accept',
      summary: 'The seller agrees to give the buyer more inspection time',
    }),

    defineRoute({
      ...answer('DECLINE'),
      path: '/trades/:id/inspection-extension/:requestId/decline',
      summary: 'The seller declines the request for more inspection time',
    }),

    defineRoute({
      method: 'post',
      path: '/trades/:id/accept-inspection',
      scope: 'CONSUMER',
      summary: 'The buyer confirms the item and releases the payment, having acknowledged it is final',
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: { params: tradeIdParamSchema, body: confirmReleaseBodySchema, response: tradeViewSchema },
      handler: (ctx) => confirmAndRelease(deps(), { userId: me(ctx.actor), tradeId: ctx.params.id }),
    }),
  ];
}
