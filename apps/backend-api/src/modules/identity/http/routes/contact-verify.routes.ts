// F-081: verifying the email or phone on your own account (screen VF1).
//
// Four routes, two per channel. None is retryable by an idempotency key, for `/me/phone/change`'s
// reason: a repeated start should send another code, and a repeated confirm should find its code
// already spent — both are the honest answer, and a replayed stored response would be neither.
import { defineRoute, type RouteDefinition } from '../../../../platform/http/route.js';
import {
  postConfirmContactVerification,
  postStartContactVerification,
  type ContactVerifyControllerDeps,
} from '../controllers/contact-verify.controller.js';
import {
  confirmContactVerificationBody,
  confirmContactVerificationResponse,
  startContactVerificationResponse,
  startEmailVerificationBody,
  startPhoneVerificationBody,
} from '../validations/contact-verify.validation.js';

/** F-045's budgets: a send is hourly and per caller, a guess is per minute. */
const START_BUDGET = { points: 5, durationSeconds: 3600, by: ['user' as const, 'ip' as const] };
const CONFIRM_BUDGET = { points: 10, durationSeconds: 60, by: ['user' as const, 'ip' as const] };

export function contactVerifyRoutes(deps: ContactVerifyControllerDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'post',
      path: '/me/email/verify/start',
      scope: 'CONSUMER',
      summary: 'Send a code to your email address, adding or correcting it first if you need to',
      retryable: false,
      rateLimit: START_BUDGET,
      schema: { body: startEmailVerificationBody, response: startContactVerificationResponse },
      handler: (ctx) => postStartContactVerification(deps, ctx.req, ctx.actor, 'EMAIL', ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/me/email/verify/confirm',
      scope: 'CONSUMER',
      summary: 'Prove your email address with its code',
      retryable: false,
      rateLimit: CONFIRM_BUDGET,
      schema: { body: confirmContactVerificationBody, response: confirmContactVerificationResponse },
      handler: (ctx) => postConfirmContactVerification(deps, ctx.req, ctx.actor, 'EMAIL', ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/me/phone/verify/start',
      scope: 'CONSUMER',
      summary: 'Send a code to your phone number, adding or correcting it first if you need to',
      retryable: false,
      rateLimit: START_BUDGET,
      schema: { body: startPhoneVerificationBody, response: startContactVerificationResponse },
      handler: (ctx) => postStartContactVerification(deps, ctx.req, ctx.actor, 'PHONE', ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/me/phone/verify/confirm',
      scope: 'CONSUMER',
      summary: 'Prove your phone number with its code',
      retryable: false,
      rateLimit: CONFIRM_BUDGET,
      schema: { body: confirmContactVerificationBody, response: confirmContactVerificationResponse },
      handler: (ctx) => postConfirmContactVerification(deps, ctx.req, ctx.actor, 'PHONE', ctx.body),
    }),
  ];
}
