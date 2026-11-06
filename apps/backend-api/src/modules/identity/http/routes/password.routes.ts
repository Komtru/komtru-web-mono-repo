// Login and the password routes (M1 §10.1, screens E4, AC2, AC3).
//
// §S4 names four budgets and three of them live here: login 5/min/identifier + 20/min/IP, and
// password reset 3/hour/identifier. `RateLimitSpec` carries ONE window per route, so the tightest
// one M1 names is the one declared, and the looser per-IP figure is folded into it — a per-IP
// budget cannot be looser than the per-identifier one it shares a window with without a second
// spec, and the identifier bound is the one that actually stops an attacker.
import { defineRoute, type RouteDefinition } from '../../../../platform/http/route.js';
import { sha256 } from '../../../../platform/crypto/hmac.js';
import { classifyIdentifier, normaliseEmail, normalisePhone } from '../../../../platform/identifiers.js';
import { splitProofToken } from '../../domain/otp/challenge.js';
import {
  changeOwnPassword,
  forgotPassword,
  resetPassword,
  signIn,
  type PasswordControllerDeps,
} from '../controllers/password.controller.js';
import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  forgotPasswordResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  passwordChangedResponseSchema,
  resetPasswordRequestSchema,
} from '../validations/password.validation.js';

/**
 * The budget subject for a free-form identifier.
 *
 * Canonicalised first, so `JANE@Gmail.com`, `jane@gmail.com` and `j.ane+x@googlemail.com` share one
 * budget rather than three — a limiter that counts spellings does not limit anything. Then
 * digested, because the subject becomes a Redis key and a log field and §S12 is absolute.
 */
export const loginIdentifier = ({ body }: { body: unknown }): string | undefined => {
  const { identifier } = body as { identifier?: unknown };
  if (typeof identifier !== 'string') return undefined;
  const trimmed = identifier.trim();
  const kind = classifyIdentifier(trimmed);

  if (kind === 'EMAIL') {
    try {
      return sha256(normaliseEmail(trimmed).emailNormal).toString('hex');
    } catch {
      return sha256(trimmed.toLowerCase()).toString('hex');
    }
  }
  if (kind === 'PHONE') {
    const normalised = normalisePhone(trimmed);
    return sha256(normalised?.phoneE164 ?? trimmed).toString('hex');
  }
  return sha256(trimmed.replace(/^@/, '').toLowerCase()).toString('hex');
};

/** The challenge id half of a reset token: a budget key that is not itself the secret. */
const resetTokenSubject = ({ body }: { body: unknown }): string | undefined => {
  const { resetToken } = body as { resetToken?: unknown };
  if (typeof resetToken !== 'string') return undefined;
  return splitProofToken(resetToken)?.challengeId;
};

const fingerprint = ({ body }: { body: unknown }): string | undefined => {
  const { deviceFingerprint } = body as { deviceFingerprint?: unknown };
  return typeof deviceFingerprint === 'string' ? deviceFingerprint : undefined;
};

export function passwordRoutes(deps: PasswordControllerDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'post',
      path: '/auth/login',
      scope: 'PUBLIC',
      summary: 'Sign in with an email, a phone or a username and a password',
      /**
       * False, for T-031's reason on `/auth/refresh`: the response carries a refresh token, and the
       * idempotency gate stores a completed response in `platform.idempotency_keys.response` as
       * plaintext jsonb for 24 hours. Declaring it retryable would turn a database dump into live
       * credentials. A repeated sign-in is also perfectly safe to just do again.
       */
      retryable: false,
      /**
       * §S4 exactly: 5/min/identifier and 20/min/IP. They are two windows because they bound two
       * different things — one account's password being guessed, and one source's volume — and
       * collapsing them onto the tighter figure would cap a whole carrier-grade-NAT pool at five
       * sign-ins a minute, which is an outage for a large part of this market and does not slow an
       * attacker who varies their source. The device key is the one that bounds that attacker.
       */
      rateLimit: {
        points: 5,
        durationSeconds: 60,
        by: ['identifier', 'ip', 'device'],
        perKey: { ip: { points: 20, durationSeconds: 60 } },
        identifierBucket: 'password-login',
        identifierFrom: loginIdentifier,
        deviceFrom: fingerprint,
      },
      schema: { body: loginRequestSchema, response: loginResponseSchema },
      handler: (ctx) => signIn(deps, ctx.req, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/auth/password/forgot',
      scope: 'PUBLIC',
      summary: 'Send a reset code to the account behind an identifier (screen AC2)',
      status: 202,
      /** Always 202 with the same shape, so a repeat changes nothing a caller can observe. */
      retryable: false,
      /**
       * §S4: password reset 3/hour/identifier. The per-IP budget is separate and much looser for
       * the carrier-grade-NAT reason above — three recoveries an hour for everyone sharing one
       * public address would deny the flow to a whole neighbourhood.
       */
      rateLimit: {
        points: 3,
        durationSeconds: 3600,
        by: ['identifier', 'ip', 'device'],
        perKey: { ip: { points: 60, durationSeconds: 3600 } },
        identifierFrom: loginIdentifier,
        deviceFrom: fingerprint,
      },
      schema: { body: forgotPasswordRequestSchema, response: forgotPasswordResponseSchema },
      handler: (ctx) => forgotPassword(deps, ctx.req, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/auth/password/reset',
      scope: 'PUBLIC',
      summary: 'Set a new password with a reset token (screen AC3)',
      /** A spent token is spent; a repeat is a 422, which is the honest answer and not a replay. */
      retryable: false,
      rateLimit: {
        points: 10,
        durationSeconds: 60,
        by: ['identifier', 'ip', 'device'],
        identifierFrom: resetTokenSubject,
        deviceFrom: fingerprint,
      },
      schema: { body: resetPasswordRequestSchema, response: passwordChangedResponseSchema },
      handler: (ctx) => resetPassword(deps, ctx.req, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/auth/password/change',
      scope: 'CONSUMER',
      summary: 'Change or set your own password; every other session is signed out',
      retryable: false,
      /** Keyed on the caller, who is known here, rather than on a body field. */
      rateLimit: { points: 5, durationSeconds: 60, by: ['user', 'ip'] },
      schema: { body: changePasswordRequestSchema, response: passwordChangedResponseSchema },
      handler: (ctx) => changeOwnPassword(deps, ctx.req, ctx.actor, ctx.body),
    }),
  ];
}
