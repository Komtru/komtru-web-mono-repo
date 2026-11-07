// T-039 as HTTP: `GET /me`, the close and NDPA routes, and account recovery. A thin layer; the rules
// are in lifecycle.service.ts, ndpa.service.ts and recovery.service.ts. This file resolves who is
// calling and where from, and nothing here logs a body (the close body carries a password).
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import type { z } from 'zod';
import { ApiError } from '../../../../platform/errors.js';
import { requireUserId, type Actor } from '../../../../platform/http/principal.js';
import { users } from '../../infrastructure/postgres/schema/users.js';
import { getAccountNotice, closeOwnAccount, type CloseInput } from '../../services/lifecycle.service.js';
import { requestDataExport, requestErasure, type NdpaDeps } from '../../services/ndpa.service.js';
import {
  decideRecovery,
  listRecoveryRequests,
  requestRecovery,
  type RecoveryDeps,
} from '../../services/recovery.service.js';
import type {
  closeAccountBody,
  recoveryDecisionBody,
  recoveryIntakeBody,
  recoveryQuery,
} from '../validations/lifecycle.validation.js';
import { requireReason, staffActor } from './admin.controller.js';
import { callerAgent, callerIp } from './request.js';

export type LifecycleControllerDeps = NdpaDeps & RecoveryDeps;

const SIGN_IN = 'Sign in to manage your account';

const closeInput = (req: Request, actor: Actor, body: z.output<typeof closeAccountBody>): CloseInput => ({
  userId: requireUserId(actor, SIGN_IN),
  sessionId: actor.principal?.sessionId,
  reason: body.reason,
  password: body.password,
  stepUpToken: body.stepUpToken,
  ip: callerIp(req),
  userAgent: callerAgent(req),
});

/**
 * `GET /me`: who I am and the state of my account. The `account` block is the data behind screens
 * AS1/AS2 (suspension), CA1 (close) and the restricted banner.
 */
export async function getMe(deps: LifecycleControllerDeps, actor: Actor) {
  const userId = requireUserId(actor, SIGN_IN);
  const user = (
    await deps.db
      .select({
        id: users.id,
        publicId: users.publicId,
        username: users.username,
        verificationLevel: users.verificationLevel,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
  return { ...user, account: await getAccountNotice(deps.db, deps.ports ?? {}, userId) };
}

export async function postClose(
  deps: LifecycleControllerDeps,
  req: Request,
  actor: Actor,
  body: z.output<typeof closeAccountBody>,
) {
  const closed = await closeOwnAccount(deps, closeInput(req, actor, body));
  return { status: 'CLOSED' as const, sessionsRevoked: closed.sessionsRevoked };
}

export function postDataExport(deps: LifecycleControllerDeps, req: Request, actor: Actor) {
  return requestDataExport(deps, {
    userId: requireUserId(actor, SIGN_IN),
    sessionId: actor.principal?.sessionId,
    ip: callerIp(req),
    userAgent: callerAgent(req),
  });
}

export async function postErasure(
  deps: LifecycleControllerDeps,
  req: Request,
  actor: Actor,
  body: z.output<typeof closeAccountBody>,
) {
  const receipt = await requestErasure(deps, closeInput(req, actor, body));
  return { status: 'CLOSED' as const, scheduledFor: receipt.scheduledFor };
}

export function postRecoveryRequest(
  deps: LifecycleControllerDeps,
  req: Request,
  body: z.output<typeof recoveryIntakeBody>,
) {
  return requestRecovery(deps, {
    identifier: body.identifier,
    method: body.method,
    ...(body.evidenceRefs ? { evidenceRefs: body.evidenceRefs } : {}),
    ip: callerIp(req),
  });
}

export function getRecoveryQueue(
  deps: LifecycleControllerDeps,
  req: Request,
  actor: Actor,
  query: z.output<typeof recoveryQuery>,
) {
  return listRecoveryRequests(deps.db, {
    actor: staffActor(actor, req),
    reason: requireReason(req, query.reason),
    status: query.status,
    page: query.page,
    limit: query.limit,
  });
}

export function postRecoveryDecision(
  deps: LifecycleControllerDeps,
  req: Request,
  actor: Actor,
  requestId: string,
  body: z.output<typeof recoveryDecisionBody>,
) {
  return decideRecovery(deps, {
    actor: staffActor(actor, req),
    requestId,
    decision: body.decision,
    reason: requireReason(req, body.reason),
  });
}
