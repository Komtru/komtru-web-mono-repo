// M6 §11's admin surface as HTTP. Every handler does the same three things before it calls a service:
// it requires a STAFF principal, it requires a REASON where the action changes something (a 400
// without one, as M1 §10.6 says), and it hands over the caller's live roles. The services write the
// audit rows and events, so a route cannot forget to.
import { isIP } from 'node:net';
import type { Request } from 'express';
import type { z } from 'zod';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { requireUserId, type Actor } from '../../../platform/http/principal.js';
import type { StaffActor } from '../../identity/index.js';
import type { CaseActor } from '../../cases/index.js';
import { listDuplicateFlags, resolveDuplicateFlag } from '../services/duplicate.service.js';
import {
  assignReview,
  decideReview,
  executeLevelOverride,
  getKycQueueItem,
  listKycQueue,
  requestOverride,
} from '../services/review.service.js';
import type {
  decideBody,
  flagsQuery,
  overrideExecuteBody,
  overrideRequestBody,
  queueQuery,
  resolveFlagBody,
} from './admin.validations.js';

export interface TrustAdminDeps {
  db: () => Db;
}

interface Ctx {
  actor: Actor;
  req: Request;
}

const MAX_REASON_LENGTH = 1000;
const SIGN_IN = 'Sign in with a staff session';

/** The caller as the services want it, read off the principal built from the database this request. */
export function staffActor({ actor, req }: Ctx): StaffActor & CaseActor {
  return {
    userId: requireUserId(actor, SIGN_IN),
    roles: actor.principal?.roles ?? [],
    sessionId: actor.principal?.sessionId,
    ip: req.ip !== undefined && isIP(req.ip) ? req.ip : null,
    userAgent: req.get('user-agent') ?? null,
  };
}

/** The body member wins over `X-Admin-Reason`; whitespace counts as missing. 400 without one. */
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

export const listQueueHandler = (deps: TrustAdminDeps, query: z.output<typeof queueQuery>) =>
  listKycQueue(deps.db(), {
    caseType: query.type,
    includeFinished: query.show === 'all',
    page: query.page,
    limit: query.limit,
  });

export const queueItemHandler = (deps: TrustAdminDeps, requestId: string) =>
  getKycQueueItem(deps.db(), requestId);

export async function assignHandler(deps: TrustAdminDeps, ctx: Ctx, requestId: string) {
  const taken = await assignReview(deps.db(), { actor: staffActor(ctx), requestId });
  return { id: taken.id, state: taken.state, ownerUserId: taken.ownerUserId };
}

export const decideHandler = (
  deps: TrustAdminDeps,
  ctx: Ctx,
  requestId: string,
  body: z.output<typeof decideBody>,
) =>
  decideReview(deps.db(), {
    actor: staffActor(ctx),
    requestId,
    outcome: body.outcome,
    reason: requireReason(ctx.req, body.reason),
    policyCitation: body.policyCitation,
    rejectionCode: body.rejectionCode,
  });

export const listFlagsHandler = (deps: TrustAdminDeps, query: z.output<typeof flagsQuery>) =>
  listDuplicateFlags(deps.db(), { status: query.status, page: query.page, limit: query.limit });

export const resolveFlagHandler = (
  deps: TrustAdminDeps,
  ctx: Ctx,
  flagId: string,
  body: z.output<typeof resolveFlagBody>,
) =>
  resolveDuplicateFlag(deps.db(), {
    actor: staffActor(ctx),
    flagId,
    resolution: body.resolution,
    notes: requireReason(ctx.req, body.reason),
    approvalId: body.approvalId,
    policyCitation: body.policyCitation,
  });

export const requestOverrideHandler = (
  deps: TrustAdminDeps,
  ctx: Ctx,
  body: z.output<typeof overrideRequestBody>,
) => {
  const actor = staffActor(ctx);
  const reason = requireReason(ctx.req, body.reason);
  return body.kind === 'LEVEL'
    ? requestOverride(deps.db(), {
        actor,
        kind: 'LEVEL',
        userId: body.userId,
        direction: body.direction,
        toLevel: body.toLevel,
        reason,
      })
    : requestOverride(deps.db(), { actor, kind: 'CLEAR_DUPLICATE', flagId: body.flagId, reason });
};

export const executeOverrideHandler = (
  deps: TrustAdminDeps,
  ctx: Ctx,
  approvalId: string,
  body: z.output<typeof overrideExecuteBody>,
) =>
  executeLevelOverride(deps.db(), {
    actor: staffActor(ctx),
    approvalId,
    userId: body.userId,
    direction: body.direction,
    toLevel: body.toLevel,
    reason: requireReason(ctx.req, body.reason),
  });
