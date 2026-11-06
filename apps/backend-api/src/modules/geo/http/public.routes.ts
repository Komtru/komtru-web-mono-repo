// The dropdown APIs (design 7.8, Q17) and "My city isn't listed".
//
// The reads are PUBLIC: an address form on a signup screen needs a state list before it has a session,
// and the catalog is published reference data, not a secret. Each carries a per-IP budget sized for a
// typeahead, and `no-cache`, so a browser revalidates with its ETag instead of serving a stale list
// after staff change the catalog; the Redis cache behind it is what keeps that cheap.
import type { Response } from 'express';
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import { requireUserId } from '../../../platform/http/principal.js';
import { getCity, listStateCities, listStates, searchCities } from '../services/catalog.service.js';
import { submitCityRequest } from '../services/requests.service.js';
import type { GeoHttpDeps } from './context.js';
import {
  cityListResponse,
  cityParams,
  cityRequestResponse,
  cityWithStateResponse,
  searchQuery,
  searchResponse,
  stateListResponse,
  stateParams,
  submitRequestBody,
} from './validations.js';

const PUBLIC_BUDGET = { points: 300, durationSeconds: 60, by: ['ip' as const] };
const SUBMIT_BUDGET = { points: 10, durationSeconds: 60, by: ['user' as const, 'ip' as const] };

/** Set only once the lookup succeeded: an error is never cacheable. */
async function revalidated<T>(res: Response, lookup: () => Promise<T>): Promise<T> {
  const value = await lookup();
  res.setHeader('Cache-Control', 'no-cache');
  return value;
}

export function geoPublicRoutes(deps: GeoHttpDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'get',
      path: '/geo/states',
      scope: 'PUBLIC',
      summary: 'Nigeria’s 36 states and the FCT, for a state dropdown',
      paginated: 'cursor',
      rateLimit: PUBLIC_BUDGET,
      schema: { response: stateListResponse },
      handler: (ctx) =>
        revalidated(ctx.res, () =>
          listStates(deps.db(), deps.cache(), { limit: ctx.query.limit ?? 20, cursor: ctx.cursor }),
        ),
    }),

    defineRoute({
      method: 'get',
      path: '/geo/states/:stateId/cities',
      scope: 'PUBLIC',
      summary: 'The active cities of one state, for a city dropdown',
      paginated: 'cursor',
      rateLimit: PUBLIC_BUDGET,
      schema: { params: stateParams, response: cityListResponse },
      handler: (ctx) =>
        revalidated(ctx.res, () =>
          listStateCities(deps.db(), deps.cache(), ctx.params.stateId, {
            limit: ctx.query.limit ?? 20,
            cursor: ctx.cursor,
          }),
        ),
    }),

    defineRoute({
      method: 'get',
      path: '/geo/cities',
      scope: 'PUBLIC',
      summary: 'City typeahead: active cities whose name or alias starts with q, optionally in one state',
      paginated: 'cursor',
      rateLimit: PUBLIC_BUDGET,
      schema: { query: searchQuery, response: searchResponse },
      handler: (ctx) =>
        revalidated(ctx.res, () =>
          searchCities(deps.db(), deps.cache(), {
            q: ctx.query.q,
            stateId: ctx.query.stateId,
            limit: ctx.query.limit ?? 20,
            cursor: ctx.cursor,
          }),
        ),
    }),

    defineRoute({
      method: 'get',
      path: '/geo/cities/:cityId',
      scope: 'PUBLIC',
      summary: 'One city by id, including a deactivated one, so old records still show it',
      rateLimit: PUBLIC_BUDGET,
      schema: { params: cityParams, response: cityWithStateResponse },
      handler: (ctx) => revalidated(ctx.res, () => getCity(deps.db(), deps.cache(), ctx.params.cityId)),
    }),

    defineRoute({
      method: 'post',
      path: '/geo/city-requests',
      scope: 'CONSUMER',
      summary: 'Ask for a city that is not listed ("My city isn’t listed")',
      status: 201,
      // Idempotent by construction (a repeat returns the pending request), but the key keeps a retried
      // tap from racing the unique index at all.
      retryable: true,
      rateLimit: SUBMIT_BUDGET,
      schema: { body: submitRequestBody, response: cityRequestResponse },
      handler: (ctx) =>
        submitCityRequest(deps.db(), {
          userId: requireUserId(ctx.actor, 'Sign in to request a city'),
          stateId: ctx.body.stateId,
          cityName: ctx.body.cityName,
        }),
    }),
  ];
}
