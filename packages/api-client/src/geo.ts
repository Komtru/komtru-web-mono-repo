// The location catalog's endpoints (T-046): the state and city dropdowns every app shares, the typeahead,
// and "My city isn't listed". Mirrors the backend's geo routes field for field.
//
// The platform caps a cursor page at 100 and a route cannot raise it, so a dropdown asks for the
// largest page (`GEO_PAGE_LIMIT`) and follows `nextCursor` to the end: 37 states and every seeded
// state's cities arrive in one request each.
import {
  GEO_PAGE_LIMIT,
  cityRequestBodySchema,
  cityRequestSchema,
  citySchema,
  paginatedSchema,
  stateSchema,
} from '@komtru/shared-types';
import { z } from 'zod';
import { defineEndpoint } from './contracts.js';
import type { ApiClient } from './client.js';
import { collectCursorPages } from './pagination.js';

export { GEO_PAGE_LIMIT };

const pageQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.int().min(1).max(GEO_PAGE_LIMIT).optional(),
});

const cityWithState = citySchema.extend({ stateName: z.string() });

export const listStates = defineEndpoint({
  method: 'get',
  path: '/geo/states',
  scope: 'PUBLIC',
  paginated: 'cursor',
  schema: { query: pageQuery, response: paginatedSchema(stateSchema) },
});

export const listStateCities = defineEndpoint({
  method: 'get',
  path: '/geo/states/:stateId/cities',
  scope: 'PUBLIC',
  paginated: 'cursor',
  schema: {
    params: z.object({ stateId: z.uuid() }),
    query: pageQuery,
    response: paginatedSchema(citySchema),
  },
});

export const searchCities = defineEndpoint({
  method: 'get',
  path: '/geo/cities',
  scope: 'PUBLIC',
  paginated: 'cursor',
  schema: {
    query: pageQuery.extend({ q: z.string().max(80).optional(), stateId: z.uuid().optional() }),
    response: paginatedSchema(cityWithState),
  },
});

/** One city, deactivated or not: how an old address, hub or trade still shows its city. */
export const getCity = defineEndpoint({
  method: 'get',
  path: '/geo/cities/:cityId',
  scope: 'PUBLIC',
  schema: { params: z.object({ cityId: z.uuid() }), response: cityWithState },
});

export const submitCityRequest = defineEndpoint({
  method: 'post',
  path: '/geo/city-requests',
  scope: 'CONSUMER',
  retryable: true,
  schema: { body: cityRequestBodySchema, response: cityRequestSchema },
});

/** Every state, all pages. */
export const fetchAllStates = (client: ApiClient, signal?: AbortSignal) =>
  collectCursorPages((cursor) =>
    client.call(
      listStates,
      { query: { limit: GEO_PAGE_LIMIT, ...(cursor ? { cursor } : {}) } },
      signal ? { signal } : {},
    ),
  );

/** Every active city of one state, all pages. */
export const fetchAllCities = (client: ApiClient, stateId: string, signal?: AbortSignal) =>
  collectCursorPages((cursor) =>
    client.call(
      listStateCities,
      { params: { stateId }, query: { limit: GEO_PAGE_LIMIT, ...(cursor ? { cursor } : {}) } },
      signal ? { signal } : {},
    ),
  );
