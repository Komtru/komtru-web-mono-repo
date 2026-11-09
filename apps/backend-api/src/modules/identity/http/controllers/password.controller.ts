// Login and the three password endpoints, as HTTP.
//
// The one thing to check in this file: `signIn` has exactly ONE throw, and every failure the
// service can produce reaches it. §S3 asks for the same status, the same body and the same timing
// whatever went wrong, and a controller with two error branches is how that promise is broken
// later by someone being helpful.
import type { Request } from 'express';
import type { z } from 'zod';
import type { Db } from '../../../../db/index.js';
import { ApiError } from '../../../../platform/errors.js';
import type { Actor } from '../../../../platform/http/principal.js';
import { login } from '../../services/login.service.js';
import { completeMfaLogin, resolveMfaToken } from '../../services/mfa-login.service.js';
import { findOwnFactor, issueFactorChallenge, type MfaDeps } from '../../services/mfa.service.js';
import {
  changePassword,
  completePasswordReset,
  startPasswordReset,
} from '../../services/password.service.js';
import type {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  mfaChallengeRequestSchema,
  mfaVerifyRequestSchema,
  resetPasswordRequestSchema,
} from '../validations/password.validation.js';
import { callerAgent, callerIp } from './request.js';

export interface PasswordControllerDeps extends MfaDeps {
  db: Db;
}

/**
 * The single rejection. Built fresh each time rather than shared, because an ApiError carries a
 * stack and sharing one instance across requests would attribute every rejection to the first.
 *
 * `extensions` is used by ONE caller, `/auth/mfa/verify`, to add `attemptsRemaining` — and only
 * once the mfa token itself has matched, which means the caller has already proved the password.
 * The status, the code and the title are identical either way, so §S3's promise is untouched: what
 * differs is a field nobody without the credentials can ever see.
 */
export const rejected = (extensions?: Record<string, unknown>): ApiError =>
  new ApiError(
    401,
    'INVALID_CREDENTIALS',
    'Sign in failed',
    'Check the details and try again, or reset your password',
    undefined,
    extensions,
  );

export async function signIn(
  deps: PasswordControllerDeps,
  req: Request,
  body: z.output<typeof loginRequestSchema>,
) {
  const result = await login(deps.db, deps, {
    identifier: body.identifier,
    password: body.password,
    ...(body.deviceFingerprint ? { deviceFingerprint: body.deviceFingerprint } : {}),
    ip: callerIp(req),
    userAgent: callerAgent(req),
  });

  // §10.1's second 200. Placed BEFORE the rejection so this function still has exactly ONE throw:
  // a controller with two error branches is how §S3's promise gets broken later by somebody being
  // helpful.
  if (result.outcome === 'MFA_REQUIRED') {
    return {
      mfaRequired: true as const,
      mfaToken: result.mfaToken,
      expiresAt: result.expiresAt.getTime(),
      factors: result.factors,
    };
  }
  if (result.outcome === 'ACCOUNT_NOTICE') {
    // AS1/AS2: a 403 whose body carries the screen's data (a notice key and a support reference,
    // never the staff-written reason). Only a caller who proved the password gets here.
    throw new ApiError(
      403,
      'FORBIDDEN',
      'This account cannot sign in',
      'Contact support with your reference',
      undefined,
      { account: result.notice },
    );
  }
  if (result.outcome !== 'SESSION') throw rejected();

  return {
    accessToken: result.session.accessToken,
    refreshToken: result.session.refreshToken,
    scope: result.session.scope,
    expiresIn: result.session.expiresIn,
    expiresAt: Date.now() + result.session.expiresIn * 1000,
    nextStep: result.nextStep,
    user: result.user,
  };
}

/**
 * `POST /auth/mfa/verify`.
 *
 * Two outcomes reach the client and both are the SAME 401 with the same code and the same title;
 * only an extension member differs. That is not a §S3 exception: §S3 is about an unauthenticated
 * caller learning whether an account exists, and everyone who can see `attemptsRemaining` here has
 * already presented a valid `mfaToken`, which is only ever issued against a correct password. A
 * forged token gets the bare rejection with no counter at all, so the field cannot be used to tell
 * a real token from an invented one.
 */
export async function verifyMfa(
  deps: PasswordControllerDeps,
  req: Request,
  body: z.output<typeof mfaVerifyRequestSchema>,
) {
  const result = await completeMfaLogin(deps.db, deps, {
    mfaToken: body.mfaToken,
    factorId: body.factorId,
    ...(body.code !== undefined ? { code: body.code } : {}),
    ...(body.assertion !== undefined ? { assertion: body.assertion } : {}),
    ...(body.deviceFingerprint ? { deviceFingerprint: body.deviceFingerprint } : {}),
    ip: callerIp(req),
    userAgent: callerAgent(req),
  });

  if (result.outcome === 'WRONG_CODE') {
    throw rejected({ attemptsRemaining: result.attemptsRemaining });
  }
  if (result.outcome !== 'SESSION') throw rejected();

  return {
    accessToken: result.session.accessToken,
    refreshToken: result.session.refreshToken,
    scope: result.session.scope,
    expiresIn: result.session.expiresIn,
    expiresAt: Date.now() + result.session.expiresIn * 1000,
    nextStep: result.nextStep,
    user: result.user,
  };
}

/**
 * `POST /auth/mfa/challenge`: send the SMS, or build the passkey options.
 *
 * Answers the SAME 401 for an unknown token as `/auth/mfa/verify` does, and charges no attempt —
 * asking for a code to be sent is not a guess, and metering it would let a user who taps "resend"
 * twice lock themselves out of their own sign-in.
 */
export async function challengeMfa(
  deps: PasswordControllerDeps,
  req: Request,
  body: z.output<typeof mfaChallengeRequestSchema>,
) {
  const challenge = await deps.db.transaction(async (tx) => {
    const resolved = await resolveMfaToken(tx, deps, body.mfaToken);
    if (!resolved) return null;

    const factor = await findOwnFactor(tx, { userId: resolved.userId, factorId: body.factorId });
    if (!factor) return null;

    return issueFactorChallenge(tx, deps, {
      userId: resolved.userId,
      factor,
      ceremonyKey: `mfa:${resolved.challengeId}`,
      ip: callerIp(req),
    });
  });

  if (!challenge) throw rejected();
  if (challenge.kind === 'PASSKEY') return { kind: 'PASSKEY' as const, options: challenge.options };

  return {
    kind: 'CODE' as const,
    challengeId: challenge.challengeId,
    maskedDestination: challenge.maskedDestination,
    expiresAt: challenge.expiresAt ? challenge.expiresAt.getTime() : null,
    delivered: challenge.delivered,
  };
}

/** 202, always, with the same shape for a known and an unknown identifier (M1 §17). */
export async function forgotPassword(
  deps: PasswordControllerDeps,
  req: Request,
  body: z.output<typeof forgotPasswordRequestSchema>,
) {
  const started = await startPasswordReset(deps.db, deps, {
    identifier: body.identifier,
    ip: callerIp(req),
    userAgent: callerAgent(req),
  });

  return {
    status: 'SENT' as const,
    challengeId: started.challengeId,
    expiresAt: started.expiresAt.getTime(),
    maskedDestination: started.maskedDestination,
  };
}

export async function resetPassword(
  deps: PasswordControllerDeps,
  req: Request,
  body: z.output<typeof resetPasswordRequestSchema>,
) {
  const result = await completePasswordReset(deps.db, deps, {
    resetToken: body.resetToken,
    newPassword: body.newPassword,
    ip: callerIp(req),
    userAgent: callerAgent(req),
  });

  if (result.outcome === 'RESET') return { ok: true as const, revokedSessions: result.revokedSessions };

  if (result.outcome === 'REJECTED') {
    throw new ApiError(422, 'VALIDATION_FAILED', 'That password cannot be used', undefined, [
      { path: 'newPassword', message: result.message },
    ]);
  }

  // Every way a token can fail answers alike: spent, expired, malformed, or never issued. Telling
  // them apart would say whether the challenge id in a captured token is still live.
  throw new ApiError(
    422,
    'OTP_INVALID',
    'That reset link is no longer usable',
    'Start the forgotten-password flow again',
  );
}

export async function changeOwnPassword(
  deps: PasswordControllerDeps,
  req: Request,
  actor: Actor,
  body: z.output<typeof changePasswordRequestSchema>,
) {
  const principal = actor.principal;
  // A CONSUMER route, so mountRoutes has already proved this; the check is here so the types do
  // not need a non-null assertion.
  if (!principal) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to change your password');

  const result = await changePassword(deps.db, deps, {
    userId: principal.userId,
    sessionId: principal.sessionId,
    ...(body.currentPassword ? { currentPassword: body.currentPassword } : {}),
    newPassword: body.newPassword,
    ip: callerIp(req),
    userAgent: callerAgent(req),
  });

  switch (result.outcome) {
    case 'CHANGED':
      return { ok: true as const, revokedSessions: result.revokedSessions };
    case 'REJECTED':
      throw new ApiError(422, 'VALIDATION_FAILED', 'That password cannot be used', undefined, [
        { path: 'newPassword', message: result.message },
      ]);
    case 'CURRENT_REQUIRED':
      // A distinct answer from WRONG_PASSWORD on purpose, and safely so: the caller already holds a
      // session for this account, so "you have a password and must send it" tells them nothing
      // they could not learn by sending a wrong one.
      throw new ApiError(422, 'VALIDATION_FAILED', 'Your current password is required', undefined, [
        { path: 'currentPassword', message: 'Enter your current password to set a new one' },
      ]);
    case 'WRONG_PASSWORD':
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'That password is not correct');
  }
}
