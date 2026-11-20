// `POST /auth/logistics/login` and `POST /auth/logistics/mfa/verify` (T-086, m2 §2). The consumer
// credential flow — a password, and a second factor only when the account has one — opening a
// LOGISTICS session for an account with a logistics membership.
//
// Two answers once the password is proved, and only then: a session (or a challenge), or
// `403 NO_LOGISTICS_ACCESS`, which the portal shows as "this account isn't attached to a logistics
// company" rather than "wrong password", because the password may be entirely right. Everything
// before the password is proved is the same single 401 every other sign-in gives (§S3).
import type { Request } from 'express';
import type { z } from 'zod';
import { ApiError } from '../../../../platform/errors.js';
import { login } from '../../services/login.service.js';
import { completeMfaLogin } from '../../services/mfa-login.service.js';
import type { loginRequestSchema, mfaVerifyRequestSchema } from '../validations/password.validation.js';
import { rejected, type PasswordControllerDeps } from './password.controller.js';
import { callerAgent, callerIp } from './request.js';

export const noLogisticsAccess = (): ApiError =>
  new ApiError(
    403,
    'NO_LOGISTICS_ACCESS',
    "This account isn't attached to a logistics company",
    'Ask your company admin to add you, then sign in again',
  );

export async function logisticsSignIn(
  deps: PasswordControllerDeps,
  req: Request,
  body: z.output<typeof loginRequestSchema>,
) {
  const result = await login(
    deps.db,
    deps,
    {
      identifier: body.identifier,
      password: body.password,
      ...(body.deviceFingerprint ? { deviceFingerprint: body.deviceFingerprint } : {}),
      ip: callerIp(req),
      userAgent: callerAgent(req),
    },
    { scope: 'LOGISTICS' },
  );

  if (result.outcome === 'MFA_REQUIRED') {
    return {
      mfaRequired: true as const,
      mfaToken: result.mfaToken,
      expiresAt: result.expiresAt.getTime(),
      factors: result.factors,
    };
  }
  if (result.outcome === 'NO_LOGISTICS_ACCESS') throw noLogisticsAccess();
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

export async function logisticsVerifyMfa(
  deps: PasswordControllerDeps,
  req: Request,
  body: z.output<typeof mfaVerifyRequestSchema>,
) {
  const result = await completeMfaLogin(deps.db, deps, {
    mfaToken: body.mfaToken,
    factorId: body.factorId,
    scope: 'LOGISTICS',
    ...(body.code !== undefined ? { code: body.code } : {}),
    ...(body.assertion !== undefined ? { assertion: body.assertion } : {}),
    ...(body.deviceFingerprint ? { deviceFingerprint: body.deviceFingerprint } : {}),
    ip: callerIp(req),
    userAgent: callerAgent(req),
  });

  if (result.outcome === 'WRONG_CODE') throw rejected({ attemptsRemaining: result.attemptsRemaining });
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
