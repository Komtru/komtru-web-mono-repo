// T-075's read routes (m8 plan §7):
//
//   GET /trades/:id/refunds   CR3, SC2: the trade's refunds, for either party
//   GET /me/refunds           the caller's refunds as a buyer, newest first
//
// There is deliberately no route that creates a refund. A refund is decided by the ledger on a trade's
// own request (`trades.refund.requested`), against the trade's own charge; nothing a client sends can
// name an amount or a charge (m8 §5).
import { REFUND_FEE_TREATMENTS, REFUND_SCOPES, REFUND_STATUSES, paginatedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { requireUserId, type Actor } from '../../../platform/http/principal.js';
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import { listMyRefunds, listRefundsForTrade, type RefundQueryDeps } from '../services/refundQuery.service.js';

const SIGN_IN = 'Sign in to see your refunds';
const me = (actor: Actor): string => requireUserId(actor, SIGN_IN);
const kobo = z.string().regex(/^\d{1,19}$/);

export const refundViewSchema = z.object({
  id: z.uuid(),
  tradeId: z.uuid(),
  reference: z.string(),
  status: z.enum(REFUND_STATUSES),
  scope: z.enum(REFUND_SCOPES),
  reason: z.string(),
  currency: z.string(),
  itemAmountMinor: kobo,
  feeAmountMinor: kobo,
  amountMinor: kobo,
  buyerProtectionFeeTreatment: z.enum(REFUND_FEE_TREATMENTS),
  failureReason: z.string().nullable(),
  requestedAt: z.string(),
  completedAt: z.string().nullable(),
  failedAt: z.string().nullable(),
});

const tradeIdParamSchema = z.object({ id: z.uuid().transform((id) => id.toLowerCase()) });

export function refundRoutes(deps: () => RefundQueryDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'get',
      path: '/trades/:id/refunds',
      scope: 'CONSUMER',
      summary: "A trade's refunds, newest first, for either party",
      schema: { params: tradeIdParamSchema, response: z.object({ refunds: z.array(refundViewSchema) }) },
      handler: (ctx) => listRefundsForTrade(deps(), { userId: me(ctx.actor), tradeId: ctx.params.id }),
    }),

    defineRoute({
      method: 'get',
      path: '/me/refunds',
      scope: 'CONSUMER',
      summary: "The caller's refunds as a buyer, newest first",
      paginated: 'cursor',
      schema: { response: paginatedSchema(refundViewSchema) },
      handler: (ctx) =>
        listMyRefunds(deps(), {
          userId: me(ctx.actor),
          limit: ctx.query.limit ?? 20,
          ...(ctx.cursor ? { cursor: ctx.cursor } : {}),
        }),
    }),
  ];
}
