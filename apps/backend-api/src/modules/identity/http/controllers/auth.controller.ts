// The session endpoints: rotate a refresh token, end a session, publish the verification key.
//
// Every failure here is a 401, because every one of them means the credential the client holds is
// no longer usable. The `code` is what the client branches on (`packages/shared-types/src/errors.ts`):
// TOKEN_EXPIRED for a session that simply timed out, SESSION_REVOKED for one that was ended, and
// UNAUTHENTICATED for a token nobody ever minted.
import type { ProblemCode } from '@komtru/shared-types';
import type { Request } from 'express';
import type { Db } from '../../../../db/index.js';
import { ApiError } from '../../../../platform/errors.js';
import type { TokenSigner } from '../../infrastructure/jwt/access-token.js';
import {
  refreshSession,
  revokeSessionFamily,
  type IssuedSession,
  type RefreshOutcome,
  type SessionDeps,
} from '../../services/session.service.js';
import type { logoutRequestSchema, refreshRequestSchema } from '../validations/auth.validation.js';
import type { z } from 'zod';

export interface AuthControllerDeps extends SessionDeps {
  db: Db;
}

const FAILURE: Record<
  Exclude<RefreshOutcome['outcome'], 'ROTATED'>,
  { code: ProblemCode; detail: string }
> = {
  UNKNOWN: { code: 'UNAUTHENTICATED', detail: 'Sign in again' },
  EXPIRED: { code: 'TOKEN_EXPIRED', detail: 'This session timed out; sign in again' },
  REVOKED: { code: 'SESSION_REVOKED', detail: 'This session was ended; sign in again' },
  REUSED: {
    code: 'SESSION_REVOKED',
    detail: 'This session was ended for security reasons; sign in again',
  },
  USER_INACTIVE: { code: 'SESSION_REVOKED', detail: 'This account cannot be used right now' },
};

/** `X-Forwarded-For` is honoured only as far as `TRUST_PROXY_HOPS` lets express honour it. */
const callerIp = (req: Request): string | null => req.ip ?? null;
const callerAgent = (req: Request): string | null => req.get('user-agent') ?? null;

const asResponse = (session: IssuedSession) => ({
  accessToken: session.accessToken,
  refreshToken: session.refreshToken,
  scope: session.scope,
  expiresIn: session.expiresIn,
  expiresAt: Date.now() + session.expiresIn * 1000,
});

export async function refresh(
  deps: AuthControllerDeps,
  req: Request,
  body: z.output<typeof refreshRequestSchema>,
): Promise<ReturnType<typeof asResponse>> {
  const result = await refreshSession(deps.db, deps, {
    refreshToken: body.refreshToken,
    ip: callerIp(req),
    userAgent: callerAgent(req),
  });
  if (result.outcome === 'ROTATED') return asResponse(result.session);

  const { code, detail } = FAILURE[result.outcome];
  throw new ApiError(401, code, 'This session is no longer valid', detail);
}

/**
 * Always 200, whatever the token was. A logout that answered differently for a token that exists
 * would be a free oracle for anyone holding a guess.
 */
export async function logout(
  deps: AuthControllerDeps,
  body: z.output<typeof logoutRequestSchema>,
): Promise<{ ok: true }> {
  await revokeSessionFamily(deps.db, {
    refreshToken: body.refreshToken,
    allDevices: body.allDevices,
    reason: body.allDevices ? 'logout_all_devices' : 'logout',
  });
  return { ok: true };
}

export const jwks = (signer: TokenSigner): { keys: Record<string, unknown>[] } => signer.jwks();
