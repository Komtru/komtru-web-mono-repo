// §10.5's `/me/devices` and `/me/sessions` lines.
//
// `GET /me/sessions` and `DELETE /me/sessions/{id}` belonged to no ticket after T-031; they are on
// the same screen as the device list, so T-036 takes them rather than leave them homeless a third
// time.
import { pageRequestSchema } from '@komtru/shared-types';
import { defineRoute, type RouteDefinition } from '../../../../platform/http/route.js';
import {
  deleteDevice,
  deleteSession,
  getDevices,
  getSessions,
  postDevice,
  postDeviceTrust,
  type DeviceControllerDeps,
} from '../controllers/device.controller.js';
import {
  deviceIdParamSchema,
  deviceListResponseSchema,
  deviceResponseSchema,
  okResponseSchema,
  registerDeviceRequestSchema,
  sessionIdParamSchema,
  sessionListResponseSchema,
} from '../validations/device.validation.js';

/** Keyed on the caller, who is known on every one of these: `user` plus `ip` and no body field. */
const OWN_BUDGET = { points: 30, durationSeconds: 60, by: ['user', 'ip'] as const };

export function deviceRoutes(deps: DeviceControllerDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'post',
      path: '/me/devices',
      scope: 'CONSUMER',
      summary: 'Announce this device and its push token',
      /**
       * False: the whole point is an upsert on `(user_id, device_fingerprint)`, so a repeat writes
       * the same row and returns the same body. An idempotency key would store a device record for
       * 24 hours to protect an operation that is already idempotent in the database.
       */
      retryable: false,
      rateLimit: { ...OWN_BUDGET, by: [...OWN_BUDGET.by] },
      schema: { body: registerDeviceRequestSchema, response: deviceResponseSchema },
      handler: (ctx) => postDevice(deps, ctx.req, ctx.actor, ctx.body),
    }),

    defineRoute({
      method: 'get',
      path: '/me/devices',
      scope: 'CONSUMER',
      summary: 'The devices this account has been used on',
      paginated: 'page',
      schema: { query: pageRequestSchema, response: deviceListResponseSchema },
      handler: (ctx) => getDevices(deps, ctx.actor, ctx.query),
    }),

    defineRoute({
      method: 'delete',
      path: '/me/devices/:id',
      scope: 'CONSUMER',
      summary: 'Retire a device and stop pushing to it',
      /** Retiring an already-retired device writes the same row; a repeat is genuinely harmless. */
      retryable: false,
      rateLimit: { ...OWN_BUDGET, by: [...OWN_BUDGET.by] },
      schema: { params: deviceIdParamSchema, response: okResponseSchema },
      handler: (ctx) => deleteDevice(deps, ctx.req, ctx.actor, ctx.params),
    }),

    defineRoute({
      method: 'post',
      path: '/me/devices/:id/trust',
      scope: 'CONSUMER',
      summary: 'Mark a device as one you recognise',
      retryable: false,
      rateLimit: { ...OWN_BUDGET, by: [...OWN_BUDGET.by] },
      schema: { params: deviceIdParamSchema, response: okResponseSchema },
      handler: (ctx) => postDeviceTrust(deps, ctx.req, ctx.actor, ctx.params),
    }),

    defineRoute({
      method: 'get',
      path: '/me/sessions',
      scope: 'CONSUMER',
      summary: 'Where this account is currently signed in',
      paginated: 'page',
      schema: { query: pageRequestSchema, response: sessionListResponseSchema },
      handler: (ctx) => getSessions(deps, ctx.actor, ctx.query),
    }),

    defineRoute({
      method: 'delete',
      path: '/me/sessions/:id',
      scope: 'CONSUMER',
      summary: 'Sign out one device',
      /** Revoking an already-revoked family is harmless, which is why `/auth/logout` says the same. */
      retryable: false,
      rateLimit: { ...OWN_BUDGET, by: [...OWN_BUDGET.by] },
      schema: { params: sessionIdParamSchema, response: okResponseSchema },
      handler: (ctx) => deleteSession(deps, ctx.req, ctx.actor, ctx.params),
    }),
  ];
}
