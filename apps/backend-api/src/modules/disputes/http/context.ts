// What the dispute routes need from the process, and how an actor crosses from HTTP into the
// services.
import { isIP } from 'node:net';
import type { Request } from 'express';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { requireUserId, type Actor } from '../../../platform/http/principal.js';
import type { RequestActor } from '../services/transition.js';
import type { DisputePorts } from '../services/ports.js';

export interface DisputesHttpDeps {
  db: () => Db;
  ports: () => DisputePorts;
}

export const SIGN_IN = 'Sign in to see this dispute';

export const me = (actor: Actor): string => requireUserId(actor, SIGN_IN);

const request = (req: Request) => ({
  ip: req.ip !== undefined && isIP(req.ip) ? req.ip : null,
  userAgent: req.get('user-agent') ?? null,
});

/**
 * Who is calling, and from where. Deliberately does NOT say which side of the dispute they are on:
 * the HTTP layer has not read the case, so it cannot know, and a guess would put the wrong word on
 * the timeline. `asParty` in the service resolves it once the row is in hand.
 */
export function requestActor(actor: Actor, req: Request, signIn = SIGN_IN): RequestActor {
  return {
    userId: requireUserId(actor, signIn),
    sessionId: actor.principal?.sessionId,
    ...request(req),
  };
}

/** A reviewer or lead acting from the console. */
export const staffActor = (actor: Actor, req: Request): RequestActor =>
  requestActor(actor, req, 'Sign in with a staff session');

const MAX_REASON_LENGTH = 1000;

/**
 * A staff change says why. The body member wins over `X-Admin-Reason`; whitespace counts as
 * missing. 400 without one, matching the cases and geo admin surfaces.
 */
export function requireReason(req: Request, reason: string | undefined): string {
  const trimmed = (reason ?? req.get('x-admin-reason') ?? '').trim();
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
