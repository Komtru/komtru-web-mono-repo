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
import type { AccountDeps } from '../../services/auth.service.js';
import { login } from '../../services/login.service.js';
import {
  changePassword,
  completePasswordReset,
  startPasswordReset,
} from '../../services/password.service.js';
import type {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  resetPasswordRequestSchema,
} from '../validations/password.validation.js';
import { callerAgent, callerIp } from './request.js';

export interface PasswordControllerDeps extends AccountDeps {
  db: Db;
}

/**
 * The single rejection. Built fresh each time rather than shared, because an ApiError carries a
 * stack and sharing one instance across requests would attribute every rejection to the first.
 */
const rejected = (): ApiError =>
  new ApiError(
    401,
    'INVALID_CREDENTIALS',
    'Sign in failed',
    'Check the details and try again, or reset your password',
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
