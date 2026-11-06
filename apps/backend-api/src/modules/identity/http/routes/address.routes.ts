// T-042: the saved delivery addresses of the signed-in buyer.
//
//   GET   /me/addresses              the live addresses, default first, cursor-paginated
//   POST  /me/addresses              add one (the first becomes the default)
//   PATCH /me/addresses/:id          edit one
//   POST  /me/addresses/:id/archive  retire one; an address is never deleted, trades snapshot it
//   POST  /me/addresses/:id/default  make one the default
import { defineRoute, type RouteDefinition } from '../../../../platform/http/route.js';
import {
  getAddresses,
  patchAddress,
  postAddress,
  postAddressArchive,
  postAddressDefault,
  type AddressControllerDeps,
} from '../controllers/address.controller.js';
import {
  addressIdParamSchema,
  addressListResponseSchema,
  addressResponseSchema,
  createAddressBodySchema,
  listAddressesQuerySchema,
  updateAddressBodySchema,
} from '../validations/address.validation.js';

/** Keyed on the caller, who is known on every one of these: `user` plus `ip` and no body field. */
const OWN_BUDGET = { points: 30, durationSeconds: 60, by: ['user', 'ip'] as const };

export function addressRoutes(deps: AddressControllerDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'get',
      path: '/me/addresses',
      scope: 'CONSUMER',
      summary: 'My saved delivery addresses',
      paginated: 'cursor',
      schema: { query: listAddressesQuerySchema, response: addressListResponseSchema },
      handler: (ctx) => getAddresses(deps, ctx.actor, ctx.query, ctx.cursor),
    }),

    defineRoute({
      method: 'post',
      path: '/me/addresses',
      scope: 'CONSUMER',
      summary: 'Save a delivery address',
      status: 201,
      /** True: a second POST is a second address, so a retried tap needs the key to be harmless. */
      retryable: true,
      rateLimit: { ...OWN_BUDGET, by: [...OWN_BUDGET.by] },
      schema: { body: createAddressBodySchema, response: addressResponseSchema },
      handler: (ctx) => postAddress(deps, ctx.req, ctx.actor, ctx.body),
    }),

    defineRoute({
      method: 'patch',
      path: '/me/addresses/:id',
      scope: 'CONSUMER',
      summary: 'Edit a saved delivery address',
      /** A repeat writes the same values: nothing to protect with a key. */
      retryable: false,
      rateLimit: { ...OWN_BUDGET, by: [...OWN_BUDGET.by] },
      schema: {
        params: addressIdParamSchema,
        body: updateAddressBodySchema,
        response: addressResponseSchema,
      },
      handler: (ctx) => patchAddress(deps, ctx.req, ctx.actor, ctx.params, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/me/addresses/:id/archive',
      scope: 'CONSUMER',
      summary: 'Archive a saved delivery address (it is kept, never deleted)',
      /** Archiving an archived address returns it unchanged. */
      retryable: false,
      rateLimit: { ...OWN_BUDGET, by: [...OWN_BUDGET.by] },
      schema: { params: addressIdParamSchema, response: addressResponseSchema },
      handler: (ctx) => postAddressArchive(deps, ctx.req, ctx.actor, ctx.params),
    }),

    defineRoute({
      method: 'post',
      path: '/me/addresses/:id/default',
      scope: 'CONSUMER',
      summary: 'Make a saved delivery address the default',
      /** Making the default the default returns it unchanged. */
      retryable: false,
      rateLimit: { ...OWN_BUDGET, by: [...OWN_BUDGET.by] },
      schema: { params: addressIdParamSchema, response: addressResponseSchema },
      handler: (ctx) => postAddressDefault(deps, ctx.req, ctx.actor, ctx.params),
    }),
  ];
}
