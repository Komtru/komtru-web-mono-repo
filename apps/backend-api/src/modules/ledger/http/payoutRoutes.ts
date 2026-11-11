// T-073's seller-facing payout routes:
//
//   GET    /payouts/banks                     the cached bank list, for the account picker
//   GET    /me/payout-accounts                the caller's accounts (masked)
//   POST   /me/payout-accounts                add one; verified by a job, answered at once
//   POST   /me/payout-accounts/:id/default    where automatic payouts go
//   DELETE /me/payout-accounts/:id            remove (disable) one
//   GET    /me/payout-preferences             how the caller is paid
//   PUT    /me/payout-preferences             change it
//   GET    /me/payouts/summary                Seller-6's balance card, AB5's fee line
//   GET    /me/payouts                        the history (WF1)
//   GET    /me/payouts/:id                    one payout, the receipt (PR1)
//   POST   /me/payouts                        withdraw (AB5)
//
// Every /me route resolves the caller from the session and answers 404 for somebody else's row.
import { requireUserId, type Actor } from '../../../platform/http/principal.js';
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import { ApiError } from '../../../platform/errors.js';
import type { BankListCache } from '../infrastructure/bankListCache.js';
import {
  addPayoutAccount,
  listAccounts,
  removePayoutAccount,
  setDefaultPayoutAccount,
  type PayoutAccountDeps,
} from '../services/payoutAccount.service.js';
import {
  getPayout,
  listPayouts,
  payoutSummary,
  requestPayout,
  type PayoutServiceDeps,
} from '../services/payout.service.js';
import { getPayoutPreference, setPayoutPreference } from '../services/payoutPreference.service.js';
import {
  addPayoutAccountBodySchema,
  bankListSchema,
  idParamSchema,
  payoutAccountListSchema,
  payoutAccountViewSchema,
  payoutListSchema,
  payoutPreferenceBodySchema,
  payoutPreferenceViewSchema,
  payoutSummarySchema,
  payoutViewSchema,
  requestPayoutBodySchema,
} from './payout.validation.js';

const SIGN_IN = 'Sign in to manage your payouts';
const me = (actor: Actor): string => requireUserId(actor, SIGN_IN).toLowerCase();
const MONEY_BUDGET = { points: 10, durationSeconds: 60, by: ['user', 'ip'] as ('user' | 'ip')[] };

export interface PayoutRouteDeps {
  accounts: PayoutAccountDeps;
  payouts: PayoutServiceDeps;
  banks: BankListCache;
}

export function payoutRoutes(deps: () => PayoutRouteDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'get',
      path: '/payouts/banks',
      scope: 'CONSUMER',
      summary: 'The banks a seller can be paid into',
      schema: { response: bankListSchema },
      handler: async () => {
        const banks = await deps().banks.read();
        if (!banks) {
          throw new ApiError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'The bank list is not available yet');
        }
        return { banks };
      },
    }),

    defineRoute({
      method: 'get',
      path: '/me/payout-accounts',
      scope: 'CONSUMER',
      summary: "The caller's payout accounts, masked",
      schema: { response: payoutAccountListSchema },
      handler: (ctx) => listAccounts(deps().accounts, me(ctx.actor)),
    }),

    defineRoute({
      method: 'post',
      path: '/me/payout-accounts',
      scope: 'CONSUMER',
      summary: 'Add a bank account to be paid into; it is verified with the bank before use',
      // Adding the same account again returns the row already on file.
      retryable: false,
      status: 202,
      rateLimit: { ...MONEY_BUDGET },
      schema: { body: addPayoutAccountBodySchema, response: payoutAccountViewSchema },
      handler: (ctx) =>
        addPayoutAccount(deps().accounts, {
          userId: me(ctx.actor),
          bankCode: ctx.body.bankCode,
          accountNumber: ctx.body.accountNumber,
        }),
    }),

    defineRoute({
      method: 'post',
      path: '/me/payout-accounts/:id/default',
      scope: 'CONSUMER',
      summary: 'Make a verified account the one automatic payouts go to',
      retryable: false,
      schema: { params: idParamSchema, response: payoutAccountViewSchema },
      handler: (ctx) =>
        setDefaultPayoutAccount(deps().accounts, { userId: me(ctx.actor), payoutAccountId: ctx.params.id }),
    }),

    defineRoute({
      method: 'delete',
      path: '/me/payout-accounts/:id',
      scope: 'CONSUMER',
      summary: 'Remove a payout account',
      retryable: false,
      schema: { params: idParamSchema, response: payoutAccountViewSchema },
      handler: (ctx) =>
        removePayoutAccount(deps().accounts, { userId: me(ctx.actor), payoutAccountId: ctx.params.id }),
    }),

    defineRoute({
      method: 'get',
      path: '/me/payout-preferences',
      scope: 'CONSUMER',
      summary: 'How the caller is paid out',
      schema: { response: payoutPreferenceViewSchema },
      handler: (ctx) => getPayoutPreference(deps().payouts.db, me(ctx.actor)),
    }),

    defineRoute({
      method: 'put',
      path: '/me/payout-preferences',
      scope: 'CONSUMER',
      summary: 'Choose manual or automatic payouts',
      // Setting the same mode twice is the same state.
      retryable: false,
      schema: { body: payoutPreferenceBodySchema, response: payoutPreferenceViewSchema },
      handler: (ctx) =>
        setPayoutPreference(deps().payouts.db, { userId: me(ctx.actor), mode: ctx.body.mode }),
    }),

    defineRoute({
      method: 'get',
      path: '/me/payouts/summary',
      scope: 'CONSUMER',
      summary: 'The available balance, what is on its way, and the payout fee',
      schema: { response: payoutSummarySchema },
      handler: (ctx) => payoutSummary(deps().payouts, me(ctx.actor)),
    }),

    defineRoute({
      method: 'get',
      path: '/me/payouts',
      scope: 'CONSUMER',
      summary: "The caller's payouts, newest first",
      paginated: 'cursor',
      schema: { response: payoutListSchema },
      handler: (ctx) =>
        listPayouts(deps().payouts, {
          userId: me(ctx.actor),
          limit: ctx.query.limit ?? 20,
          ...(ctx.cursor ? { cursor: ctx.cursor } : {}),
        }),
    }),

    defineRoute({
      method: 'get',
      path: '/me/payouts/:id',
      scope: 'CONSUMER',
      summary: 'One payout: its outcome and receipt',
      schema: { params: idParamSchema, response: payoutViewSchema },
      handler: (ctx) => getPayout(deps().payouts, { userId: me(ctx.actor), payoutId: ctx.params.id }),
    }),

    defineRoute({
      method: 'post',
      path: '/me/payouts',
      scope: 'CONSUMER',
      summary: 'Withdraw from the available balance to a verified account',
      // A double tap must be one withdrawal: the idempotency key is required.
      retryable: true,
      status: 201,
      rateLimit: { ...MONEY_BUDGET },
      schema: { body: requestPayoutBodySchema, response: payoutViewSchema },
      handler: (ctx) =>
        requestPayout(deps().payouts, {
          userId: me(ctx.actor),
          amountMinor: ctx.body.amountMinor,
          ...(ctx.body.payoutAccountId ? { payoutAccountId: ctx.body.payoutAccountId } : {}),
        }),
    }),
  ];
}
