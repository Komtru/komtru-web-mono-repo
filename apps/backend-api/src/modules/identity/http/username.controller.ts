// M1 §10.3's username endpoints.
//
// The principal is read off `ctx.actor`, which mount.ts sets from `resolveActor` — `user:<uuid>` or
// `anon`. T-031 supplies the real resolver and the `authenticate({ scope })` middleware; until then
// `scope` here is metadata the registry records rather than a gate it enforces, and these routes
// answer 401 to everyone. Declaring them now is what lets T-031 wire one thing rather than four.
import { pagedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { requireUserId } from '../../../platform/http/principal.js';
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import { USERNAME_MAX_LENGTH } from '../domain/username/policy.js';
import {
  changeUsername,
  checkUsernameAvailability,
  claimUsername,
  listUsernameHistory,
  type UsernameServiceDeps,
} from '../services/username.service.js';

/** The handle as it arrives from a client: unvalidated beyond a length bound, because §6.1's rules
 * produce better messages than a zod regex would, and the service owns them. The upper bound is
 * generous of the `@` sigil and of whitespace the normaliser trims. */
const usernameInput = z
  .string()
  .min(1)
  .max(USERNAME_MAX_LENGTH + 2);

const availabilityResponse = z.object({
  username: z.string(),
  available: z.boolean(),
  reason: z.string().optional(),
  problem: z.string().optional(),
  suggestions: z.array(z.string()),
});

const usernameResponse = z.object({ username: z.string() });

const historyResponse = pagedSchema(
  z.object({
    username: z.string(),
    claimedAt: z.date(),
    releasedAt: z.date().nullable(),
    quarantineUntil: z.date().nullable(),
    reason: z.string().nullable(),
  }),
);

const MANAGE_HANDLE = 'Sign in to manage your handle';

export function usernameRoutes(deps: UsernameServiceDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'get',
      path: '/usernames/availability',
      // A handle is public by design — party lookup resolves one, and the whole point of a handle is
      // that a counterparty can read it out. The rate limit, not authentication, is what stops bulk
      // harvesting, and requiring a session would break the sign-up flow that needs this first.
      scope: 'PUBLIC',
      summary: 'Check whether a handle can be claimed, with suggestions if not',
      rateLimit: { points: 20, durationSeconds: 60, by: ['ip', 'user'] },
      schema: {
        query: z.object({ username: usernameInput }),
        response: availabilityResponse,
      },
      handler: async ({ query, actor }) => {
        // Optional here, unlike the routes below: availability is a PUBLIC lookup, and a signed-in
        // caller only gets the extra "this one is already yours" answer.
        const forUserId = actor.principal?.userId;
        return checkUsernameAvailability(deps, query.username, {
          ...(forUserId ? { forUserId } : {}),
        });
      },
    }),

    defineRoute({
      method: 'post',
      path: '/me/username',
      scope: 'CONSUMER',
      summary: 'Claim a handle for the first time',
      // A repeat of the same claim is not harmless: the second attempt sees the handle taken by the
      // caller's own first attempt and would answer 409 to a client that simply retried a timeout.
      retryable: true,
      status: 201,
      rateLimit: { points: 5, durationSeconds: 60, by: ['ip', 'user'] },
      schema: { body: z.object({ username: usernameInput }), response: usernameResponse },
      handler: async ({ body, actor }) =>
        claimUsername(deps, { userId: requireUserId(actor, MANAGE_HANDLE), username: body.username }),
    }),

    defineRoute({
      method: 'patch',
      path: '/me/username',
      scope: 'CONSUMER',
      summary: 'Change a handle, within the §6.4 cooldown and lifetime cap',
      retryable: true,
      rateLimit: { points: 5, durationSeconds: 60, by: ['ip', 'user'] },
      schema: {
        body: z.object({ username: usernameInput, reason: z.string().min(1).max(500) }),
        response: usernameResponse.extend({ previous: z.string() }),
      },
      handler: async ({ body, actor }) =>
        changeUsername(deps, {
          userId: requireUserId(actor, MANAGE_HANDLE),
          username: body.username,
          reason: body.reason,
        }),
    }),

    defineRoute({
      method: 'get',
      path: '/me/username/history',
      scope: 'CONSUMER',
      summary: 'Every handle this account has held',
      paginated: 'page',
      schema: { response: historyResponse },
      // `page` and `limit` are merged into the query by mount.ts for any route declaring pagination,
      // and it rejects a response longer than `limit` — so they have to reach the query, not just
      // the declaration.
      handler: async ({ actor, query }) =>
        listUsernameHistory(deps, requireUserId(actor, MANAGE_HANDLE), {
          page: query.page,
          limit: query.limit,
        }),
    }),
  ];
}
