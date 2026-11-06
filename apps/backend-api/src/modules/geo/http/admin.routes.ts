// Staff routes (T-046), all behind `geo.manage` (SUPER_ADMIN and OPERATIONS_ADMIN, from T-037's RBAC
// catalogue). Cities are added, renamed and deactivated; city requests are added, merged or rejected.
// There is no DELETE route and there never will be: a city an address, hub or trade holds only goes
// inactive.
//
// A reason is required on every city change and on a rejection (400 without one, as config's admin
// surface does). Adding or merging a requested city may carry one but need not.
//
// After a commit that changed what a dropdown shows, each handler bumps the cache version, so this
// instance's next read sees the change at once; other instances and the worker are covered by the
// `geo.catalog.changed` subscriber.
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import {
  addCity,
  listCitiesAdmin,
  listStatesAdmin,
  setCityActive,
  updateCity,
} from '../services/admin.service.js';
import {
  addRequestedCity,
  listCityRequests,
  mergeRequest,
  rejectRequest,
} from '../services/requests.service.js';
import { geoActor, optionalReason, requireReason, type GeoHttpDeps } from './context.js';
import {
  addCityBody,
  addRequestBody,
  adminCitiesQuery,
  adminCityListResponse,
  adminCityResponse,
  adminRequestListResponse,
  adminStateListResponse,
  cityRequestResponse,
  idParams,
  mergeRequestBody,
  reasonBody,
  requestQueueQuery,
  stateParams,
  updateCityBody,
} from './validations.js';

const READ_BUDGET = { points: 120, durationSeconds: 60, by: ['user' as const, 'ip' as const] };
const WRITE_BUDGET = { points: 30, durationSeconds: 60, by: ['user' as const, 'ip' as const] };
const PERMISSION = 'geo.manage';

export function geoAdminRoutes(deps: GeoHttpDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'get',
      path: '/admin/geo/states',
      scope: 'STAFF',
      permission: PERMISSION,
      summary: 'States with their city counts',
      paginated: 'cursor',
      rateLimit: READ_BUDGET,
      schema: { response: adminStateListResponse },
      handler: (ctx) => listStatesAdmin(deps.db(), { limit: ctx.query.limit ?? 20, cursor: ctx.cursor }),
    }),

    defineRoute({
      method: 'get',
      path: '/admin/geo/states/:stateId/cities',
      scope: 'STAFF',
      permission: PERMISSION,
      summary: 'A state’s cities, deactivated ones included',
      paginated: 'cursor',
      rateLimit: READ_BUDGET,
      schema: { params: stateParams, query: adminCitiesQuery, response: adminCityListResponse },
      handler: (ctx) =>
        listCitiesAdmin(deps.db(), ctx.params.stateId, {
          limit: ctx.query.limit ?? 20,
          cursor: ctx.cursor,
          includeInactive: ctx.query.includeInactive,
        }),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/geo/cities',
      scope: 'STAFF',
      permission: PERMISSION,
      summary: 'Add a city to a state; a reason is required',
      status: 201,
      // A repeat is a 409 (the city now exists), never a second city.
      retryable: false,
      rateLimit: WRITE_BUDGET,
      schema: { body: addCityBody, response: adminCityResponse },
      handler: async (ctx) => {
        const actor = geoActor(ctx.actor, ctx.req);
        const reason = requireReason(ctx.req, ctx.body.reason);
        const city = await addCity(deps.db(), {
          actor,
          stateId: ctx.body.stateId,
          name: ctx.body.name,
          aliases: ctx.body.aliases,
          reason,
        });
        await deps.cache().invalidate();
        return city;
      },
    }),

    defineRoute({
      method: 'patch',
      path: '/admin/geo/cities/:id',
      scope: 'STAFF',
      permission: PERMISSION,
      summary: 'Rename a city or change its aliases; a reason is required',
      // Setting a city to what it already is writes nothing, which is deliberate.
      retryable: false,
      rateLimit: WRITE_BUDGET,
      schema: { params: idParams, body: updateCityBody, response: adminCityResponse },
      handler: async (ctx) => {
        const actor = geoActor(ctx.actor, ctx.req);
        const reason = requireReason(ctx.req, ctx.body.reason);
        const { city, changed } = await updateCity(deps.db(), {
          actor,
          cityId: ctx.params.id,
          name: ctx.body.name,
          aliases: ctx.body.aliases,
          reason,
        });
        if (changed) await deps.cache().invalidate();
        return city;
      },
    }),

    ...(['deactivate', 'activate'] as const).map((verb) =>
      defineRoute({
        method: 'post',
        path: `/admin/geo/cities/:id/${verb}`,
        scope: 'STAFF',
        permission: PERMISSION,
        summary:
          verb === 'deactivate'
            ? 'Take a city out of the dropdowns (it is never deleted); a reason is required'
            : 'Put a deactivated city back in the dropdowns; a reason is required',
        retryable: false,
        rateLimit: WRITE_BUDGET,
        schema: { params: idParams, body: reasonBody, response: adminCityResponse },
        handler: async (ctx) => {
          const actor = geoActor(ctx.actor, ctx.req);
          const reason = requireReason(ctx.req, ctx.body.reason);
          const { city, changed } = await setCityActive(deps.db(), {
            actor,
            cityId: ctx.params.id,
            active: verb === 'activate',
            reason,
          });
          if (changed) await deps.cache().invalidate();
          return city;
        },
      }),
    ),

    defineRoute({
      method: 'get',
      path: '/admin/geo/city-requests',
      scope: 'STAFF',
      permission: PERMISSION,
      summary: 'The city-request queue, oldest first, with how many people asked for each name',
      paginated: 'cursor',
      rateLimit: READ_BUDGET,
      schema: { query: requestQueueQuery, response: adminRequestListResponse },
      handler: (ctx) =>
        listCityRequests(deps.db(), {
          limit: ctx.query.limit ?? 20,
          cursor: ctx.cursor,
          status: ctx.query.status,
          stateId: ctx.query.stateId,
        }),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/geo/city-requests/:id/add',
      scope: 'STAFF',
      permission: PERMISSION,
      summary: 'Add the requested city to the catalog and tell everyone who asked for it',
      retryable: false,
      rateLimit: WRITE_BUDGET,
      schema: { params: idParams, body: addRequestBody, response: cityRequestResponse },
      handler: async (ctx) => {
        const actor = geoActor(ctx.actor, ctx.req);
        const request = await addRequestedCity(deps.db(), {
          actor,
          requestId: ctx.params.id,
          name: ctx.body.name,
          aliases: ctx.body.aliases,
          reason: optionalReason(ctx.req, ctx.body.reason),
        });
        await deps.cache().invalidate();
        return request;
      },
    }),

    defineRoute({
      method: 'post',
      path: '/admin/geo/city-requests/:id/merge',
      scope: 'STAFF',
      permission: PERMISSION,
      summary: 'Fold the request into an existing city and tell everyone who asked for it',
      retryable: false,
      rateLimit: WRITE_BUDGET,
      schema: { params: idParams, body: mergeRequestBody, response: cityRequestResponse },
      handler: async (ctx) => {
        const actor = geoActor(ctx.actor, ctx.req);
        const request = await mergeRequest(deps.db(), {
          actor,
          requestId: ctx.params.id,
          cityId: ctx.body.cityId,
          addAlias: ctx.body.addAlias,
          reason: optionalReason(ctx.req, ctx.body.reason),
        });
        await deps.cache().invalidate();
        return request;
      },
    }),

    defineRoute({
      method: 'post',
      path: '/admin/geo/city-requests/:id/reject',
      scope: 'STAFF',
      permission: PERMISSION,
      summary: 'Reject the request with a reason and tell everyone who asked for it',
      retryable: false,
      rateLimit: WRITE_BUDGET,
      schema: { params: idParams, body: reasonBody, response: cityRequestResponse },
      handler: (ctx) =>
        rejectRequest(deps.db(), {
          actor: geoActor(ctx.actor, ctx.req),
          requestId: ctx.params.id,
          reason: requireReason(ctx.req, ctx.body.reason),
        }),
    }),
  ];
}
