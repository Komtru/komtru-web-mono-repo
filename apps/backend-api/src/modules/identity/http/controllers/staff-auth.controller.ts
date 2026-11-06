// `POST /auth/staff/login` and `POST /auth/staff/mfa/verify` (T-037, M1 section 10.6's "STAFF-scoped
// session"). Separate routes from consumer login, with the same single rejection: whatever went
// wrong, including holding no staff role, is the same 401 a wrong password gets.
import type { Request } from 'express';
import type { z } from 'zod';
import { login } from '../../services/login.service.js';
import { completeMfaLogin } from '../../services/mfa-login.service.js';
import type { loginRequestSchema, mfaVerifyRequestSchema } from '../validations/password.validation.js';
import { rejected, type PasswordControllerDeps } from './password.controller.js';
import { callerAgent, callerIp } from './request.js';

/**
 * Password only ever buys a challenge here. There is no SESSION branch to reach: `login` for the
 * STAFF scope returns `MFA_REQUIRED` or `REJECTED`, and anything else is refused too.
 */
export async function staffSignIn(
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
    { scope: 'STAFF' },
  );

  if (result.outcome !== 'MFA_REQUIRED') throw rejected();
  return {
    mfaRequired: true as const,
    mfaToken: result.mfaToken,
    expiresAt: result.expiresAt.getTime(),
    factors: result.factors,
  };
}

export async function staffVerifyMfa(
  deps: PasswordControllerDeps,
  req: Request,
  body: z.output<typeof mfaVerifyRequestSchema>,
) {
  const result = await completeMfaLogin(deps.db, deps, {
    mfaToken: body.mfaToken,
    factorId: body.factorId,
    scope: 'STAFF',
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
