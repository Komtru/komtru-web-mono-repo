// M17 section 6. STAFF scope, with `config.view` to read and `config.manage` to change. Both are in the
// RBAC catalogue already (T-037): `config.view` for SUPER_ADMIN and OPERATIONS_ADMIN, `config.manage`
// for SUPER_ADMIN alone, because a changed window or a flipped flag moves money-adjacent behaviour for
// every user.
//
// The section 6 content proxies (templates, risk rules, ticket queues) are not here: the modules that
// own those tables do not exist yet, and D2 forbids a parallel copy. Each lands with its owner.
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import {
  changeLogHandler,
  flagsHandler,
  putFlagHandler,
  putSettingHandler,
  settingsHandler,
  type ConfigHttpDeps,
} from './controllers.js';
import {
  changeLogQuery,
  changeLogResponse,
  flagBody,
  flagListResponse,
  flagParams,
  flagResponse,
  listQuery,
  namespaceParams,
  settingBody,
  settingListResponse,
  settingParams,
  settingResponse,
} from './validations.js';

const READ_BUDGET = { points: 120, durationSeconds: 60, by: ['user' as const, 'ip' as const] };
const WRITE_BUDGET = { points: 30, durationSeconds: 60, by: ['user' as const, 'ip' as const] };

export function configAdminRoutes(deps: ConfigHttpDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'get',
      path: '/admin/config/settings/:namespace',
      scope: 'STAFF',
      permission: 'config.view',
      summary: 'The settings in one namespace',
      paginated: 'page',
      rateLimit: READ_BUDGET,
      schema: { params: namespaceParams, query: listQuery, response: settingListResponse },
      handler: (ctx) => settingsHandler(deps, ctx.params.namespace, ctx.query),
    }),

    defineRoute({
      method: 'put',
      path: '/admin/config/settings/:namespace/:key',
      scope: 'STAFF',
      permission: 'config.manage',
      summary: 'Change one setting; a reason is required',
      // A repeat is safe without an idempotency key: setting a value to what it already is writes
      // nothing (no change-log row, no audit row, no event), which is deliberate.
      retryable: false,
      rateLimit: WRITE_BUDGET,
      schema: { params: settingParams, body: settingBody, response: settingResponse },
      handler: (ctx) => putSettingHandler(deps, ctx, ctx.params, ctx.body),
    }),

    defineRoute({
      method: 'get',
      path: '/admin/config/flags',
      scope: 'STAFF',
      permission: 'config.view',
      summary: 'Every feature flag',
      paginated: 'page',
      rateLimit: READ_BUDGET,
      schema: { query: listQuery, response: flagListResponse },
      handler: (ctx) => flagsHandler(deps, ctx.query),
    }),

    defineRoute({
      method: 'put',
      path: '/admin/config/flags/:code',
      scope: 'STAFF',
      permission: 'config.manage',
      summary: 'Create or toggle a feature flag; a reason is required',
      retryable: false,
      rateLimit: WRITE_BUDGET,
      schema: { params: flagParams, body: flagBody, response: flagResponse },
      handler: (ctx) => putFlagHandler(deps, ctx, ctx.params.code, ctx.body),
    }),

    defineRoute({
      method: 'get',
      path: '/admin/config/change-log',
      scope: 'STAFF',
      permission: 'config.view',
      summary: 'The append-only history of setting and flag changes, newest first',
      paginated: 'page',
      rateLimit: READ_BUDGET,
      schema: { query: changeLogQuery, response: changeLogResponse },
      handler: (ctx) => changeLogHandler(deps, ctx.query),
    }),
  ];
}
