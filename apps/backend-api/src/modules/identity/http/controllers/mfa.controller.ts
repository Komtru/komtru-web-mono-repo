// §10.5's `/me/mfa/*` and the §S7 step-up endpoints, as HTTP.
//
// Two things live here and nowhere else.
//
// ONE — the §S7 gate. `removeFactor` and `regenerateRecoveryCodes` take a `stepUpToken` and
// `requireStepUp` throws a 403 `STEP_UP_REQUIRED` naming the factors the client may offer. 403 and
// not 401: the access token is perfectly valid, and T-031's api-client answers a 401 with a refresh
// and then a sign-out, which would end a legitimate session in the middle of the action.
//
// TWO — the ceremony key. Every WebAuthn ceremony begun on a `/me` route is scoped to the caller's
// SESSION id, so one begun in one browser cannot be finished in another.
import type { Request } from 'express';
import type { z } from 'zod';
import type { Db } from '../../../../db/index.js';
import { ApiError } from '../../../../platform/errors.js';
import { requireUserId, type Actor } from '../../../../platform/http/principal.js';
import { verifyAndRecord } from '../../services/credential.service.js';
import {
  activateSmsFactor,
  activateTotp,
  completePasskeyRegistration,
  enrolSmsFactor,
  enrolTotp,
  findOwnFactor,
  issueFactorChallenge,
  listFactors,
  passkeyRegistrationOptions,
  regenerateRecoveryCodes,
  removeFactor,
  verifyFactor,
  type MfaDeps,
} from '../../services/mfa.service.js';
import { issueStepUpToken, requireStepUp } from '../../services/step-up.service.js';
import { activeFactors } from '../../services/mfa.service.js';
import { AUDIT_ACTIONS, writeAudit } from '../../services/audit.service.js';
import type {
  activateSmsRequestSchema,
  activateTotpRequestSchema,
  passkeyRegisterRequestSchema,
  regenerateRecoveryCodesRequestSchema,
  removeFactorRequestSchema,
  stepUpChallengeRequestSchema,
  stepUpRequestSchema,
} from '../validations/mfa.validation.js';
import { callerAgent, callerIp } from './request.js';

export interface MfaControllerDeps extends MfaDeps {
  db: Db;
}

const MANAGE_MFA = 'Sign in to manage two-factor authentication';

/** The session id is the ceremony scope; a `/me` route always has one. */
const ceremonyKeyFor = (actor: Actor): string => `me:${actor.principal?.sessionId ?? 'none'}`;

/** What `requireStepUp` tells the client it may present. */
const acceptedFactorsFor = async (deps: MfaControllerDeps, userId: string): Promise<string[]> => {
  const live = await deps.db.transaction((tx) => activeFactors(tx, userId));
  return live.length > 0 ? live.map((factor) => factor.factorType) : ['PASSWORD'];
};

const wrongCode = (attemptsRemaining?: number): ApiError =>
  new ApiError(
    422,
    'OTP_INVALID',
    "That code doesn't match",
    'Check the code and try again',
    undefined,
    // Absent rather than zero when there are none left: an exhausted ceremony, an expired one and a
    // factor id nobody issued must look the same, or the endpoint says which mistake to fix.
    attemptsRemaining !== undefined && attemptsRemaining > 0 ? { attemptsRemaining } : undefined,
  );

const unusableCeremony = (): ApiError =>
  new ApiError(422, 'OTP_INVALID', 'That enrolment can no longer be completed', 'Start the setup again');

export async function getFactors(
  deps: MfaControllerDeps,
  actor: Actor,
  query: { page?: number; limit?: number },
) {
  const userId = requireUserId(actor, MANAGE_MFA);
  return listFactors(deps.db, deps, { userId, page: query.page ?? 1, limit: query.limit ?? 20 });
}

export async function postTotpEnrol(deps: MfaControllerDeps, req: Request, actor: Actor) {
  const userId = requireUserId(actor, MANAGE_MFA);
  const result = await enrolTotp(deps.db, deps, {
    // The authenticator app files the credential under this forever; the public id rather than an
    // address, for §S12's reason.
    accountName: actor.principal?.publicId ?? null,
    userId,
    ip: callerIp(req),
  });

  if (result.outcome === 'ALREADY_ENROLLED') {
    throw new ApiError(
      409,
      'CONFLICT',
      'An authenticator app is already set up',
      'Remove the existing one first',
    );
  }
  return { factorId: result.factorId, secret: result.secret, otpauthUri: result.otpauthUri };
}

export async function postTotpActivate(
  deps: MfaControllerDeps,
  req: Request,
  actor: Actor,
  body: z.output<typeof activateTotpRequestSchema>,
) {
  const userId = requireUserId(actor, MANAGE_MFA);
  const result = await activateTotp(deps.db, deps, {
    userId,
    factorId: body.factorId,
    code: body.code,
    ip: callerIp(req),
    userAgent: callerAgent(req),
  });

  if (result.outcome === 'WRONG_CODE') throw wrongCode(result.attemptsRemaining);
  if (result.outcome === 'UNKNOWN') throw unusableCeremony();
  return { factorId: result.factorId, recoveryCodes: result.recoveryCodes };
}

export async function postSmsEnrol(deps: MfaControllerDeps, req: Request, actor: Actor) {
  const userId = requireUserId(actor, MANAGE_MFA);
  const result = await enrolSmsFactor(deps.db, deps, { userId, ip: callerIp(req) });

  if (result.outcome === 'NO_VERIFIED_PHONE') {
    throw new ApiError(
      409,
      'CONFLICT',
      'No verified phone number on this account',
      'Add and verify a phone number first',
    );
  }
  if (result.outcome === 'ALREADY_ENROLLED') {
    throw new ApiError(409, 'CONFLICT', 'Text-message codes are already set up');
  }

  return {
    factorId: result.factorId,
    challengeId: result.challengeId,
    maskedDestination: result.maskedDestination,
    expiresAt: result.expiresAt.getTime(),
    delivered: result.delivered,
  };
}

export async function postSmsActivate(
  deps: MfaControllerDeps,
  req: Request,
  actor: Actor,
  body: z.output<typeof activateSmsRequestSchema>,
) {
  const userId = requireUserId(actor, MANAGE_MFA);
  const result = await activateSmsFactor(deps.db, deps, {
    userId,
    factorId: body.factorId,
    challengeId: body.challengeId,
    code: body.code,
    ip: callerIp(req),
    userAgent: callerAgent(req),
  });

  if (result.outcome === 'WRONG_CODE') throw wrongCode(result.attemptsRemaining);
  if (result.outcome === 'UNKNOWN') throw unusableCeremony();
  return { factorId: result.factorId, recoveryCodes: result.recoveryCodes };
}

export async function postPasskeyOptions(deps: MfaControllerDeps, actor: Actor) {
  const userId = requireUserId(actor, MANAGE_MFA);
  const options = await passkeyRegistrationOptions(deps.db, deps, {
    userId,
    userName: actor.principal?.publicId ?? userId,
    displayName: actor.principal?.publicId ?? userId,
    ceremonyKey: ceremonyKeyFor(actor),
  });
  return { options };
}

export async function postPasskeyVerify(
  deps: MfaControllerDeps,
  req: Request,
  actor: Actor,
  body: z.output<typeof passkeyRegisterRequestSchema>,
) {
  const userId = requireUserId(actor, MANAGE_MFA);
  const result = await completePasskeyRegistration(deps.db, deps, {
    userId,
    ceremonyKey: ceremonyKeyFor(actor),
    response: body.response,
    label: body.label ?? null,
    ip: callerIp(req),
    userAgent: callerAgent(req),
  });

  if (result.outcome === 'ALREADY_REGISTERED') {
    throw new ApiError(409, 'CONFLICT', 'That security key is already registered');
  }
  if (result.outcome === 'REJECTED') {
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'That passkey could not be verified',
      'Start the setup again',
    );
  }
  return { factorId: result.factorId, recoveryCodes: result.recoveryCodes };
}

export async function deleteFactor(
  deps: MfaControllerDeps,
  req: Request,
  actor: Actor,
  params: { id: string },
  body: z.output<typeof removeFactorRequestSchema>,
): Promise<{ ok: true }> {
  const userId = requireUserId(actor, MANAGE_MFA);
  const acceptedFactors = await acceptedFactorsFor(deps, userId);

  const result = await deps.db.transaction(async (tx) => {
    // §S7. Throws the 403 before anything is revoked, and spends the token so it cannot be reused.
    await requireStepUp(tx, deps, { userId, token: body.stepUpToken, acceptedFactors });
    return removeFactor(tx, deps, {
      userId,
      factorId: params.id,
      ip: callerIp(req),
      userAgent: callerAgent(req),
    });
  });

  if (result.outcome === 'UNKNOWN') {
    throw new ApiError(404, 'NOT_FOUND', 'That factor is not on your account');
  }
  if (result.outcome === 'LAST_FACTOR_REQUIRED') {
    // D2 C4: an admin may not leave themselves without a second factor. 409 and not 403: the
    // caller's credentials are fine and so is their step-up — the account's STATE forbids it.
    throw new ApiError(
      409,
      'CONFLICT',
      'Staff accounts must keep a second factor',
      'Add another factor before removing this one',
    );
  }
  return { ok: true };
}

export async function postRecoveryCodes(
  deps: MfaControllerDeps,
  actor: Actor,
  body: z.output<typeof regenerateRecoveryCodesRequestSchema>,
) {
  const userId = requireUserId(actor, MANAGE_MFA);
  const acceptedFactors = await acceptedFactorsFor(deps, userId);

  const codes = await deps.db.transaction(async (tx) => {
    await requireStepUp(tx, deps, { userId, token: body.stepUpToken, acceptedFactors });
    return regenerateRecoveryCodes(tx, deps, userId);
  });

  return { recoveryCodes: codes };
}

export async function postStepUpChallenge(
  deps: MfaControllerDeps,
  req: Request,
  actor: Actor,
  body: z.output<typeof stepUpChallengeRequestSchema>,
) {
  const userId = requireUserId(actor, MANAGE_MFA);

  const challenge = await deps.db.transaction(async (tx) => {
    const factor = await findOwnFactor(tx, { userId, factorId: body.factorId });
    if (!factor) return null;
    return issueFactorChallenge(tx, deps, {
      userId,
      factor,
      ceremonyKey: ceremonyKeyFor(actor),
      ip: callerIp(req),
    });
  });

  if (!challenge) throw new ApiError(404, 'NOT_FOUND', 'That factor is not on your account');
  if (challenge.kind === 'PASSKEY') return { kind: 'PASSKEY' as const, options: challenge.options };
  return {
    kind: 'CODE' as const,
    challengeId: challenge.challengeId,
    maskedDestination: challenge.maskedDestination,
    expiresAt: challenge.expiresAt ? challenge.expiresAt.getTime() : null,
    delivered: challenge.delivered,
  };
}

/**
 * Exchanges one proof for the `stepUpToken` a §S7 action will ask for.
 *
 * The password is accepted ONLY when the account holds no factor — otherwise a session a thief took
 * over could step up with a password they already used to get in, which is the opposite of what
 * §S7 is for. T-032 set the precedent in the other direction and for the same reason: a password
 * change accepts no current password exactly when there is no credential row to prove.
 */
export async function postStepUp(
  deps: MfaControllerDeps,
  req: Request,
  actor: Actor,
  body: z.output<typeof stepUpRequestSchema>,
) {
  const userId = requireUserId(actor, MANAGE_MFA);
  const ip = callerIp(req);
  const userAgent = callerAgent(req);

  const issued = await deps.db.transaction(async (tx) => {
    const live = await activeFactors(tx, userId);

    const proved =
      body.password !== undefined
        ? live.length === 0 &&
          (await verifyAndRecord(tx, deps, { userId, password: body.password })).outcome === 'OK'
        : body.factorId !== undefined &&
          (await (async () => {
            const factor = await findOwnFactor(tx, { userId, factorId: body.factorId as string });
            if (!factor) return false;
            return verifyFactor(tx, deps, {
              userId,
              factor,
              proof: {
                ...(body.code !== undefined ? { code: body.code } : {}),
                ...(body.assertion !== undefined ? { assertion: body.assertion } : {}),
              },
              ceremonyKey: ceremonyKeyFor(actor),
            });
          })());

    await writeAudit(tx, {
      action: proved ? AUDIT_ACTIONS.STEP_UP_VERIFIED : AUDIT_ACTIONS.STEP_UP_FAILED,
      outcome: proved ? 'SUCCESS' : 'FAILURE',
      actorType: 'USER',
      actorUserId: userId,
      subjectUserId: userId,
      ip,
      userAgent,
      sessionId: actor.principal?.sessionId ?? null,
      metadata: { via: body.password !== undefined ? 'password' : 'factor' },
    });

    if (!proved) return null;
    return issueStepUpToken(tx, deps, { userId, action: 'step_up', ip });
  });

  if (!issued) {
    // One answer for a wrong code, a wrong password, a factor that is not yours and a password
    // offered by an account that has a factor. None of them is worth distinguishing to a caller
    // who already holds a valid session.
    throw new ApiError(
      401,
      'INVALID_CREDENTIALS',
      'That did not confirm it is you',
      'Try again with a code from your authenticator, or your password if you have no factor set up',
    );
  }

  return { stepUpToken: issued.token, expiresAt: issued.expiresAt.getTime() };
}
