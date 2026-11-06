// §10.1's two MFA login routes and §10.5's `/me/mfa/*` and step-up lines.
//
// `/auth/mfa/*` are PUBLIC, because the caller is mid-login and has no session yet; the `mfaToken`
// is the credential. Their per-identifier budget is keyed on the CHALLENGE ID half of that token
// and never on the token, which would put a live credential into a Redis key and a log field.
import { pageRequestSchema } from '@komtru/shared-types';
import { splitProofToken } from '../../domain/otp/challenge.js';
import { defineRoute, type RouteDefinition } from '../../../../platform/http/route.js';
import { challengeMfa, verifyMfa, type PasswordControllerDeps } from '../controllers/password.controller.js';
import {
  deleteFactor,
  getFactors,
  postPasskeyOptions,
  postPasskeyVerify,
  postRecoveryCodes,
  postSmsActivate,
  postSmsEnrol,
  postStepUp,
  postStepUpChallenge,
  postTotpActivate,
  postTotpEnrol,
  type MfaControllerDeps,
} from '../controllers/mfa.controller.js';
import {
  mfaChallengeRequestSchema,
  mfaChallengeResponseSchema,
  mfaVerifyRequestSchema,
  sessionBodySchema,
} from '../validations/password.validation.js';
import {
  activateSmsRequestSchema,
  activateTotpRequestSchema,
  activatedResponseSchema,
  enrolSmsResponseSchema,
  enrolTotpResponseSchema,
  factorIdParamSchema,
  factorListResponseSchema,
  okResponseSchema,
  passkeyOptionsResponseSchema,
  passkeyRegisterRequestSchema,
  recoveryCodesResponseSchema,
  regenerateRecoveryCodesRequestSchema,
  removeFactorRequestSchema,
  stepUpChallengeRequestSchema,
  stepUpRequestSchema,
  stepUpResponseSchema,
} from '../validations/mfa.validation.js';

/** The challenge id half of an mfa token: a budget key that is not itself the secret. */
export const mfaTokenSubject = ({ body }: { body: unknown }): string | undefined => {
  const { mfaToken } = body as { mfaToken?: unknown };
  if (typeof mfaToken !== 'string') return undefined;
  return splitProofToken(mfaToken)?.challengeId;
};

export const mfaFingerprint = ({ body }: { body: unknown }): string | undefined => {
  const { deviceFingerprint } = body as { deviceFingerprint?: unknown };
  return typeof deviceFingerprint === 'string' ? deviceFingerprint : undefined;
};

/** Keyed on the caller, who is known on every `/me` route: no body field to pull a subject from. */
const OWN = (points: number, durationSeconds = 60) => ({
  points,
  durationSeconds,
  by: ['user' as const, 'ip' as const],
});

export function mfaRoutes(deps: MfaControllerDeps & PasswordControllerDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'post',
      path: '/auth/mfa/challenge',
      scope: 'PUBLIC',
      summary: 'Send the code, or build the passkey options, for a factor at sign-in',
      /** Sending a code twice costs one SMS, not a state bug; and a key would store the response. */
      retryable: false,
      rateLimit: {
        points: 30,
        durationSeconds: 60,
        by: ['ip', 'identifier', 'device'],
        identifierFrom: mfaTokenSubject,
        deviceFrom: mfaFingerprint,
      },
      schema: { body: mfaChallengeRequestSchema, response: mfaChallengeResponseSchema },
      handler: (ctx) => challengeMfa(deps, ctx.req, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/auth/mfa/verify',
      scope: 'PUBLIC',
      summary: 'Present a second factor and finish signing in',
      /**
       * False, for T-031's reason on `/auth/refresh`: the success response carries both tokens and
       * the idempotency gate stores a completed response as plaintext jsonb for 24 hours.
       */
      retryable: false,
      /**
       * The real cap on guessing is the challenge's own five attempts; this budget stops a caller
       * grinding through challenge IDS, which those five attempts say nothing about.
       */
      rateLimit: {
        points: 10,
        durationSeconds: 60,
        by: ['ip', 'identifier', 'device'],
        identifierFrom: mfaTokenSubject,
        deviceFrom: mfaFingerprint,
      },
      schema: { body: mfaVerifyRequestSchema, response: sessionBodySchema },
      handler: (ctx) => verifyMfa(deps, ctx.req, ctx.body),
    }),

    defineRoute({
      method: 'get',
      path: '/me/mfa/factors',
      scope: 'CONSUMER',
      summary: 'The factors on this account',
      paginated: 'page',
      schema: { query: pageRequestSchema, response: factorListResponseSchema },
      handler: (ctx) => getFactors(deps, ctx.actor, ctx.query),
    }),

    defineRoute({
      method: 'post',
      path: '/me/mfa/totp/enroll',
      scope: 'CONSUMER',
      summary: 'Start setting up an authenticator app (screen TF1)',
      /** The response carries the SEED; an idempotency key would store it as plaintext jsonb. */
      retryable: false,
      rateLimit: OWN(5),
      schema: { response: enrolTotpResponseSchema },
      handler: (ctx) => postTotpEnrol(deps, ctx.req, ctx.actor),
    }),

    defineRoute({
      method: 'post',
      path: '/me/mfa/totp/activate',
      scope: 'CONSUMER',
      summary: 'Confirm the authenticator app and receive the backup codes (screens TF1, TF2)',
      /** The response carries the backup codes, shown once. */
      retryable: false,
      rateLimit: OWN(10),
      schema: { body: activateTotpRequestSchema, response: activatedResponseSchema },
      handler: (ctx) => postTotpActivate(deps, ctx.req, ctx.actor, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/me/mfa/sms/enroll',
      scope: 'CONSUMER',
      summary: 'Start setting up text-message codes on the verified primary phone',
      retryable: false,
      rateLimit: OWN(5),
      schema: { response: enrolSmsResponseSchema },
      handler: (ctx) => postSmsEnrol(deps, ctx.req, ctx.actor),
    }),

    defineRoute({
      method: 'post',
      path: '/me/mfa/sms/activate',
      scope: 'CONSUMER',
      summary: 'Confirm text-message codes',
      retryable: false,
      rateLimit: OWN(10),
      schema: { body: activateSmsRequestSchema, response: activatedResponseSchema },
      handler: (ctx) => postSmsActivate(deps, ctx.req, ctx.actor, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/me/mfa/passkey/register/options',
      scope: 'CONSUMER',
      summary: 'Build the WebAuthn creation options for this session',
      /** A second call simply replaces the parked nonce, which is what a retry should do. */
      retryable: false,
      rateLimit: OWN(10),
      schema: { response: passkeyOptionsResponseSchema },
      handler: (ctx) => postPasskeyOptions(deps, ctx.actor),
    }),

    defineRoute({
      method: 'post',
      path: '/me/mfa/passkey/register/verify',
      scope: 'CONSUMER',
      summary: 'Register the passkey the browser produced',
      retryable: false,
      rateLimit: OWN(10),
      schema: { body: passkeyRegisterRequestSchema, response: activatedResponseSchema },
      handler: (ctx) => postPasskeyVerify(deps, ctx.req, ctx.actor, ctx.body),
    }),

    defineRoute({
      method: 'delete',
      path: '/me/mfa/factors/:id',
      scope: 'CONSUMER',
      summary: 'Remove a factor (§S7: step-up required)',
      /** A repeat finds the factor already revoked and answers 404; nothing to replay. */
      retryable: false,
      rateLimit: OWN(10),
      schema: {
        params: factorIdParamSchema,
        body: removeFactorRequestSchema,
        response: okResponseSchema,
      },
      handler: (ctx) => deleteFactor(deps, ctx.req, ctx.actor, ctx.params, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/me/mfa/recovery-codes',
      /**
       * POST and not §10.5's GET, deliberately. The codes are shown once and stored as HMACs, so a
       * GET could only either return plaintext this module does not keep (and §S9 forbids keeping)
       * or MUTATE on a safe method. Regenerating is the honest verb, and it is a §S7 action.
       */
      scope: 'CONSUMER',
      summary: 'Replace the backup codes and show the new ones once (screen TF2)',
      retryable: false,
      /** Three an hour: each call destroys the sheet the user may have written down. */
      rateLimit: OWN(3, 3600),
      schema: {
        body: regenerateRecoveryCodesRequestSchema,
        response: recoveryCodesResponseSchema,
      },
      handler: (ctx) => postRecoveryCodes(deps, ctx.actor, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/me/step-up/challenge',
      scope: 'CONSUMER',
      summary: 'Send the code, or build the passkey options, for a step-up',
      retryable: false,
      rateLimit: OWN(10),
      schema: { body: stepUpChallengeRequestSchema, response: mfaChallengeResponseSchema },
      handler: (ctx) => postStepUpChallenge(deps, ctx.req, ctx.actor, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/me/step-up',
      scope: 'CONSUMER',
      summary: 'Prove it is you, for a §S7 action',
      /** The response IS a credential; the idempotency gate would store it as plaintext jsonb. */
      retryable: false,
      rateLimit: OWN(10),
      schema: { body: stepUpRequestSchema, response: stepUpResponseSchema },
      handler: (ctx) => postStepUp(deps, ctx.req, ctx.actor, ctx.body),
    }),
  ];
}
