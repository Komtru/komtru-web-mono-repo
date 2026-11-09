// The registration and terms routes (M1 §10.1, §10.5).
//
// `defineRoute` is the only way a route reaches the registry, so the scope, the retry decision, the
// rate limits and the schemas are declared here and checked at boot by `assertRouteInvariants`.
import { defineRoute, type RouteDefinition } from '../../../../platform/http/route.js';
import { sha256 } from '../../../../platform/crypto/hmac.js';
import { normaliseEmail, normalisePhone } from '../../../../platform/identifiers.js';
import {
  getTerms,
  postAcceptTerms,
  publishedTerms,
  registerUser,
  resendCode,
  verifyOtp,
  type RegistrationControllerDeps,
} from '../controllers/registration.controller.js';
import {
  acceptTermsRequestSchema,
  okResponseSchema,
  publishedTermsResponseSchema,
  registerRequestSchema,
  registerResponseSchema,
  resendOtpRequestSchema,
  resendOtpResponseSchema,
  termsResponseSchema,
  verifyOtpRequestSchema,
  verifyOtpResponseSchema,
} from '../validations/registration.validation.js';

/**
 * The rate limiter's subject becomes a Redis key and a log field, so it is a digest and never the
 * address itself (§S12). Normalised first, or `Jane@Gmail.com` and `jane@gmail.com` get a budget
 * each and the limit does not limit anything.
 */
const identifierDigest = (value: string): string => sha256(value).toString('hex');

const registrationIdentifier = ({ body }: { body: unknown }): string | undefined => {
  const { channel, email, phone } = body as { channel?: string; email?: string; phone?: string };
  if (channel === 'EMAIL' && email) {
    try {
      return identifierDigest(normaliseEmail(email).emailNormal);
    } catch {
      return undefined;
    }
  }
  if (phone) {
    const normalised = normalisePhone(phone);
    return normalised ? identifierDigest(normalised.phoneE164) : undefined;
  }
  return undefined;
};

const challengeIdentifier = ({ body }: { body: unknown }): string | undefined => {
  const { challengeId } = body as { challengeId?: unknown };
  return typeof challengeId === 'string' ? challengeId : undefined;
};

const fingerprint = ({ body }: { body: unknown }): string | undefined => {
  const { deviceFingerprint } = body as { deviceFingerprint?: unknown };
  return typeof deviceFingerprint === 'string' ? deviceFingerprint : undefined;
};

export function registrationRoutes(deps: RegistrationControllerDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'post',
      path: '/auth/register',
      scope: 'PUBLIC',
      summary: 'Open an account on the email or phone channel',
      status: 201,
      /**
       * False. A repeat is NOT harmless, and it is also not safely replayable: the response carries
       * a live challenge id, and the idempotency gate stores a completed response as plaintext jsonb
       * for 24 hours (T-031's reasoning on `/auth/refresh`). A genuine second attempt gets the 409
       * the verified-uniqueness index produces, which is the honest answer.
       */
      retryable: false,
      /**
       * Three keys, which M1 §17 asks to trigger independently.
       *
       * The per-IP budget is the TIGHT one here, which is the opposite of every other auth route,
       * and deliberately: a duplicate verified contact answers 409 so a client can send the user to
       * sign in, and that makes this route an enumeration surface. An attacker walking a list of
       * candidate addresses never repeats the identifier key, so the IP budget is the only one that
       * binds them — 5/min is 7,200 probes a day per address they can source from, against 28,800
       * at the route default. A legitimate human registers once.
       */
      rateLimit: {
        points: 20,
        durationSeconds: 60,
        by: ['ip', 'identifier', 'device'],
        perKey: { ip: { points: 5, durationSeconds: 60 } },
        identifierFrom: registrationIdentifier,
        deviceFrom: fingerprint,
      },
      schema: { body: registerRequestSchema, response: registerResponseSchema },
      handler: (ctx) => registerUser(deps, ctx.req, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/auth/otp/resend',
      scope: 'PUBLIC',
      summary: "Send a fresh code for a challenge (screen E3's “Didn't get a code?”)",
      /** Issuing supersedes the previous challenge (§S6), so a repeat costs one SMS, not a state bug. */
      retryable: false,
      rateLimit: {
        points: 30,
        durationSeconds: 60,
        by: ['ip', 'identifier', 'device'],
        identifierFrom: challengeIdentifier,
        deviceFrom: fingerprint,
      },
      schema: { body: resendOtpRequestSchema, response: resendOtpResponseSchema },
      handler: (ctx) => resendCode(deps, ctx.req, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/auth/verify-otp',
      scope: 'PUBLIC',
      summary: 'Prove a channel, or exchange a reset code for a reset token',
      /** The success response carries a refresh token or a reset token; never store it (T-031). */
      retryable: false,
      /**
       * The real cap on guessing is the challenge's own five attempts (§S4), which this cannot
       * replace — the budget here stops a caller grinding through challenge IDS, which the five
       * attempts say nothing about.
       */
      rateLimit: {
        points: 60,
        durationSeconds: 60,
        by: ['ip', 'identifier', 'device'],
        identifierFrom: challengeIdentifier,
        deviceFrom: fingerprint,
      },
      schema: { body: verifyOtpRequestSchema, response: verifyOtpResponseSchema },
      handler: (ctx) => verifyOtp(deps, ctx.req, ctx.body),
    }),

    defineRoute({
      method: 'get',
      path: '/auth/terms',
      scope: 'PUBLIC',
      summary: 'The Terms and Privacy versions in force, for screen TOS1 before an account exists',
      schema: { response: publishedTermsResponseSchema },
      handler: () => Promise.resolve(publishedTerms(deps)),
    }),

    defineRoute({
      method: 'get',
      path: '/me/terms',
      scope: 'CONSUMER',
      summary: 'Which Terms are published and which this user accepted (screen TOS2)',
      schema: { response: termsResponseSchema },
      handler: (ctx) => getTerms(deps, ctx.actor),
    }),

    defineRoute({
      method: 'post',
      path: '/me/terms/accept',
      scope: 'CONSUMER',
      summary: 'Accept the current Terms and Privacy Policy (screen TOS2)',
      /** Accepting twice writes the same two versions and a second audit row; harmless. */
      retryable: false,
      rateLimit: { points: 10, durationSeconds: 60, by: ['user', 'ip'] },
      schema: { body: acceptTermsRequestSchema, response: okResponseSchema },
      handler: (ctx) => postAcceptTerms(deps, ctx.req, ctx.actor, ctx.body),
    }),
  ];
}
