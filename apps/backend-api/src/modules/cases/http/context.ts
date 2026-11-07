// What every route handler needs: the process's connections (resolved when a request arrives, since
// the platform reads `routes` before `start()` runs) and the caller as the services want them.
import { isIP } from 'node:net';
import type { Request } from 'express';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { requireUserId, type Actor } from '../../../platform/http/principal.js';
import type { AdvisoryProvider } from '../domain/advisory.js';
import type { CaseActor } from '../services/audit.js';

export interface CasesHttpDeps {
  db: () => Db;
  advisory: () => AdvisoryProvider;
}

const MAX_REASON_LENGTH = 1000;

const clean = (req: Request, reason: string | undefined): string =>
  (reason ?? req.get('x-admin-reason') ?? '').trim();

/** The body member wins over `X-Admin-Reason`; whitespace counts as missing. 400 without one. */
export function requireReason(req: Request, reason: string | undefined): string {
  const trimmed = clean(req, reason);
  if (trimmed.length > MAX_REASON_LENGTH) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'The reason is too long', undefined, [
      { path: 'reason', message: `At most ${MAX_REASON_LENGTH} characters` },
    ]);
  }
  if (trimmed.length === 0) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'A reason is required', 'Say why you are doing this', [
      { path: 'reason', message: 'Required' },
    ]);
  }
  return trimmed;
}

export function caseActor(actor: Actor, req: Request): CaseActor {
  return {
    userId: requireUserId(actor, 'Sign in with a staff session'),
    sessionId: actor.principal?.sessionId,
    ip: req.ip !== undefined && isIP(req.ip) ? req.ip : null,
    userAgent: req.get('user-agent') ?? null,
  };
}
