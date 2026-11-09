// T-061's routes (design §6, M7):
//
//   POST /trades/preview        Z3: sides, category requirements and the buyer total, stored nowhere
//   POST /trades                create a draft with its first terms
//   GET  /trades                the caller's trades, newest-relevant first (cursor-paginated)
//   GET  /trades/by-code/:code  resolve a trade code for a party or the named invitee, else 404
//   GET  /trades/:id            the trade as the caller sees it
//   GET  /trades/:id/activity   the trade's history as a party may read it (cursor-paginated)
//   POST /trades/:id/send       name the counterparty (username, email or phone) and send
//   POST /trades/:id/counter    W2/BR1: a counter-proposal, a new terms version and the turn flips
//   POST /trades/:id/accept     W1/W3: accept the version on screen; moves to PENDING_PAYMENT
//   POST /trades/:id/decline    SD1: decline with a reason
//   POST /trades/:id/cancel     CT1: cancel before funding
//   POST /trades/:id/claim      a claimed invitation holder takes their side
//
// Every mutating route is `retryable: true`: the platform's Idempotency-Key replays the stored
// response, and each service function is itself a no-op on a repeat by the same person.
import {
  canonicalTradeCodeSchema,
  tradeActivityResponseSchema,
  tradeByCodeResponseSchema,
  tradeListResponseSchema,
  tradeListStateSchema,
} from '@komtru/shared-types';
import { isIP } from 'node:net';
import { z } from 'zod';
import type { Request } from 'express';
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import { requireUserId, type Actor } from '../../../platform/http/principal.js';
import {
  acceptProposal,
  claimTradeInvitation,
  counterPropose,
  createProposal,
  previewProposal,
  sendProposal,
} from '../services/proposal.service.js';
import { cancelTrade, declineTrade, getTrade } from '../services/trade.service.js';
import type { TradeDeps } from '../services/ports.js';
import { listTradeActivity } from '../services/tradeActivity.service.js';
import { listTrades, resolveTradeByCode, withCounterparty } from '../services/tradeList.service.js';
import {
  acceptBodySchema,
  cancelBodySchema,
  counterBodySchema,
  createTradeBodySchema,
  declineBodySchema,
  previewBodySchema,
  previewResponseSchema,
  sendTradeBodySchema,
  tradeIdParamSchema,
  tradeViewSchema,
} from './trade.validation.js';

const SIGN_IN = 'Sign in to trade';
const ACTION_BUDGET = { points: 30, durationSeconds: 60, by: ['user', 'ip'] as ('user' | 'ip')[] };
/** A list is re-fetched on every push and every focus, so it gets the room an inbox needs. */
const LIST_BUDGET = { points: 120, durationSeconds: 60, by: ['user', 'ip'] as ('user' | 'ip')[] };
/**
 * A trade code is a bearer-ish secret, so a lookup by code is the tightest budget in the module:
 * a handful of tries a minute per person. The per-IP window is wider only because one carrier IP
 * is thousands of subscribers, and it is still far too small to enumerate a code space of nine million.
 */
const BY_CODE_BUDGET = {
  points: 10,
  durationSeconds: 60,
  by: ['user', 'ip'] as ('user' | 'ip')[],
  perKey: { ip: { points: 30, durationSeconds: 60 } },
};
const listQuerySchema = z.object({ state: tradeListStateSchema.default('ALL') });
const byCodeParamSchema = z.object({ code: canonicalTradeCodeSchema });
const me = (actor: Actor): string => requireUserId(actor, SIGN_IN);

type Deps = () => TradeDeps;

export function tradeRoutes(deps: Deps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'post',
      path: '/trades/preview',
      scope: 'CONSUMER',
      summary: 'Preview a trade: allowed sides, category requirements and fees',
      retryable: false,
      rateLimit: { ...ACTION_BUDGET },
      schema: { body: previewBodySchema, response: previewResponseSchema },
      handler: (ctx) => previewProposal(deps(), { userId: me(ctx.actor), ...ctx.body }),
    }),

    defineRoute({
      method: 'post',
      path: '/trades',
      scope: 'CONSUMER',
      summary: 'Create a trade proposal (draft)',
      status: 201,
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: { body: createTradeBodySchema, response: tradeViewSchema },
      handler: async (ctx) =>
        withCounterparty(deps(), await createProposal(deps(), { userId: me(ctx.actor), ...ctx.body })),
    }),

    defineRoute({
      method: 'get',
      path: '/trades',
      scope: 'CONSUMER',
      summary: 'The trades you are a party to, newest-relevant first',
      paginated: 'cursor',
      rateLimit: { ...LIST_BUDGET },
      schema: { query: listQuerySchema, response: tradeListResponseSchema },
      handler: (ctx) =>
        listTrades(deps(), {
          userId: me(ctx.actor),
          limit: ctx.query.limit ?? 20,
          state: ctx.query.state,
          cursor: ctx.cursor,
        }),
    }),

    defineRoute({
      method: 'get',
      path: '/trades/by-code/:code',
      scope: 'CONSUMER',
      summary: 'Open a trade from its code, if you are a party to it or the invitee',
      rateLimit: BY_CODE_BUDGET,
      schema: { params: byCodeParamSchema, response: tradeByCodeResponseSchema },
      handler: (ctx) => resolveTradeByCode(deps(), { userId: me(ctx.actor), tradeCode: ctx.params.code }),
    }),

    defineRoute({
      method: 'get',
      path: '/trades/:id',
      scope: 'CONSUMER',
      summary: 'A trade, as its parties see it',
      schema: { params: tradeIdParamSchema, response: tradeViewSchema },
      handler: async (ctx) =>
        withCounterparty(deps(), await getTrade(deps(), { userId: me(ctx.actor), tradeId: ctx.params.id })),
    }),

    defineRoute({
      method: 'get',
      path: '/trades/:id/activity',
      scope: 'CONSUMER',
      summary: "A trade's history, as a party may read it: labels and times, never staff detail",
      paginated: 'cursor',
      rateLimit: { ...LIST_BUDGET },
      schema: { params: tradeIdParamSchema, response: tradeActivityResponseSchema },
      handler: (ctx) =>
        listTradeActivity(deps(), {
          userId: me(ctx.actor),
          tradeId: ctx.params.id,
          limit: ctx.query.limit ?? 20,
          cursor: ctx.cursor,
        }),
    }),

    defineRoute({
      method: 'post',
      path: '/trades/:id/send',
      scope: 'CONSUMER',
      summary: 'Send a proposal to a counterparty by username, email or phone',
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: { params: tradeIdParamSchema, body: sendTradeBodySchema, response: tradeViewSchema },
      handler: async (ctx) => {
        const { username, email, phone, proofFileIds } = ctx.body;
        const counterparty = username
          ? { channel: 'USERNAME' as const, value: username }
          : email
            ? { channel: 'EMAIL' as const, value: email }
            : { channel: 'PHONE' as const, value: phone ?? '' };
        return withCounterparty(
          deps(),
          await sendProposal(deps(), {
            userId: me(ctx.actor),
            tradeId: ctx.params.id,
            counterparty,
            ip: ipOf(ctx.req),
            ...(proofFileIds ? { proofFileIds } : {}),
          }),
        );
      },
    }),

    defineRoute({
      method: 'post',
      path: '/trades/:id/counter',
      scope: 'CONSUMER',
      summary: 'Counter-propose: a new terms version, and the turn flips',
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: { params: tradeIdParamSchema, body: counterBodySchema, response: tradeViewSchema },
      handler: async (ctx) =>
        withCounterparty(
          deps(),
          await counterPropose(deps(), {
            userId: me(ctx.actor),
            tradeId: ctx.params.id,
            ...stripUndefined(ctx.body),
          }),
        ),
    }),

    defineRoute({
      method: 'post',
      path: '/trades/:id/accept',
      scope: 'CONSUMER',
      summary: 'Accept the terms on screen; the trade waits for payment',
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: { params: tradeIdParamSchema, body: acceptBodySchema, response: tradeViewSchema },
      handler: async (ctx) =>
        withCounterparty(
          deps(),
          await acceptProposal(deps(), {
            userId: me(ctx.actor),
            tradeId: ctx.params.id,
            ...stripUndefined(ctx.body),
          }),
        ),
    }),

    defineRoute({
      method: 'post',
      path: '/trades/:id/decline',
      scope: 'CONSUMER',
      summary: 'Decline a proposal, with a reason',
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: { params: tradeIdParamSchema, body: declineBodySchema, response: tradeViewSchema },
      handler: async (ctx) =>
        withCounterparty(
          deps(),
          await declineTrade(deps(), {
            userId: me(ctx.actor),
            tradeId: ctx.params.id,
            reason: ctx.body.reason,
          }),
        ),
    }),

    defineRoute({
      method: 'post',
      path: '/trades/:id/cancel',
      scope: 'CONSUMER',
      summary: 'Cancel a trade before it is funded',
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: { params: tradeIdParamSchema, body: cancelBodySchema, response: tradeViewSchema },
      handler: async (ctx) =>
        withCounterparty(
          deps(),
          await cancelTrade(deps(), {
            userId: me(ctx.actor),
            tradeId: ctx.params.id,
            ...(ctx.body.reason ? { reason: ctx.body.reason } : {}),
          }),
        ),
    }),

    defineRoute({
      method: 'post',
      path: '/trades/:id/claim',
      scope: 'CONSUMER',
      summary: 'Take your side of a trade you were invited to',
      retryable: true,
      rateLimit: { ...ACTION_BUDGET },
      schema: { params: tradeIdParamSchema, response: tradeViewSchema },
      handler: async (ctx) =>
        withCounterparty(
          deps(),
          await claimTradeInvitation(deps(), { userId: me(ctx.actor), tradeId: ctx.params.id }),
        ),
    }),
  ];
}

/** Only a parseable address is passed on; the lookup budget and audit log store it in `inet` columns. */
const ipOf = (req: Request): string | null => (req.ip !== undefined && isIP(req.ip) ? req.ip : null);

/** exactOptionalPropertyTypes: zod's `undefined` members are not the same as absent ones. */
const stripUndefined = <T extends object>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
