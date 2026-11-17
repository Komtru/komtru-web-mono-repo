// F-045: moving to a new phone number (screen SP-M05). Three steps; each is a write that carries a code and none is
// retried by an idempotency key: a repeat of a start sends a second code, which is what a retry should do, and a repeat of a
// confirmation finds its code already spent.
import { defineRoute, type RouteDefinition } from '../../../../platform/http/route.js';
import {
  postConfirmCurrentPhone,
  postConfirmNewPhone,
  postStartPhoneChange,
  type PhoneChangeControllerDeps,
} from '../controllers/phone-change.controller.js';
import {
  confirmCurrentPhoneBody,
  confirmCurrentPhoneResponse,
  confirmNewPhoneBody,
  confirmNewPhoneResponse,
  startPhoneChangeBody,
  startPhoneChangeResponse,
} from '../validations/phone-change.validation.js';

/** Keyed on the caller, who is known on every `/me` route. */
const START_BUDGET = { points: 5, durationSeconds: 3600, by: ['user' as const, 'ip' as const] };
const CONFIRM_BUDGET = { points: 10, durationSeconds: 60, by: ['user' as const, 'ip' as const] };

export function phoneChangeRoutes(deps: PhoneChangeControllerDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'post',
      path: '/me/phone/change',
      scope: 'CONSUMER',
      summary: 'Name a new phone number and send a code to the current one (screen SP-M05)',
      retryable: false,
      rateLimit: START_BUDGET,
      schema: { body: startPhoneChangeBody, response: startPhoneChangeResponse },
      handler: (ctx) => postStartPhoneChange(deps, ctx.req, ctx.actor, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/me/phone/change/confirm-current',
      scope: 'CONSUMER',
      summary: 'Prove the current number with its code, and send a code to the new one',
      retryable: false,
      rateLimit: CONFIRM_BUDGET,
      schema: { body: confirmCurrentPhoneBody, response: confirmCurrentPhoneResponse },
      handler: (ctx) => postConfirmCurrentPhone(deps, ctx.req, ctx.actor, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/me/phone/change/confirm-new',
      scope: 'CONSUMER',
      summary: 'Prove the new number with its code and make the change; the old number is told',
      retryable: false,
      rateLimit: CONFIRM_BUDGET,
      schema: { body: confirmNewPhoneBody, response: confirmNewPhoneResponse },
      handler: (ctx) => postConfirmNewPhone(deps, ctx.req, ctx.actor, ctx.body),
    }),
  ];
}
