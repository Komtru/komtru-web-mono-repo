// M1 section 10.6's `/admin/*`, as HTTP. Every handler does the same three things before it calls a
// service: it requires a STAFF principal, it requires a REASON (a 400 without one, as the spec says
// and the platform's own 422 for a schema failure is not), and it hands over the caller's live roles.
// The services write the audit row, so a route cannot forget to.
import { type z } from 'zod';
import type { Request } from 'express';
import type { Db } from '../../../../db/index.js';
import { ApiError } from '../../../../platform/errors.js';
import { requireUserId, type Actor } from '../../../../platform/http/principal.js';
import {
  decideApproval,
  listApprovals,
  requestApproval,
  type ApprovalDeps,
} from '../../services/approval.service.js';
import { AUDIT_ACTIONS } from '../../services/audit.service.js';
import { getStaffMe } from '../../services/staff-me.service.js';
import { auditStaff, grantRole, revokeRole, type StaffActor } from '../../services/rbac.service.js';
import {
  changeUserStatus,
  getUserDetail,
  listLinkedAccounts,
  listUserAuditLog,
  reserveUsername,
  revealPii,
  revokeUserSessions,
  searchUsers,
} from '../../services/user.service.js';
import type {
  approvalsQuery,
  approveBody,
  forceChangeBody,
  grantRoleBody,
  reserveBody,
  searchQuery,
  statusBody,
} from '../validations/admin.validation.js';
import type { LifecyclePorts } from '../../services/lifecycle.service.js';
import { callerAgent, callerIp } from './request.js';

export interface AdminControllerDeps extends ApprovalDeps {
  db: Db;
  /** T-039: the trade check behind a staff closure. */
  ports?: LifecyclePorts;
}

const MAX_REASON_LENGTH = 1000;
const SIGN_IN = 'Sign in with a staff session';

/** The caller as the services want it, read off the principal `resolvePrincipal` built this request. */
export function staffActor(actor: Actor, req: Request): StaffActor {
  const userId = requireUserId(actor, SIGN_IN);
  const principal = actor.principal;
  return {
    userId,
    roles: principal?.roles ?? [],
    sessionId: principal?.sessionId,
    ip: callerIp(req),
    userAgent: callerAgent(req),
  };
}

/** M1 section 10.6: "A missing reason is a 400." Whitespace is missing. */
export function requireReason(req: Request, reason: string | undefined): string {
  // `X-Admin-Reason` for a client that would rather not put prose in a URL; the body or query member
  // wins when both are sent.
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

interface Ctx {
  actor: Actor;
  req: Request;
}

export async function searchUsersHandler(
  deps: AdminControllerDeps,
  { actor, req }: Ctx,
  query: z.output<typeof searchQuery>,
) {
  return searchUsers(deps.db, {
    actor: staffActor(actor, req),
    reason: requireReason(req, query.reason),
    q: query.q,
    status: query.status,
    verificationLevel: query.verificationLevel,
    page: query.page,
    limit: query.limit,
  });
}

export async function userDetailHandler(
  deps: AdminControllerDeps,
  { actor, req }: Ctx,
  userId: string,
  reason: string | undefined,
) {
  return getUserDetail(deps.db, {
    actor: staffActor(actor, req),
    userId,
    reason: requireReason(req, reason),
  });
}

export async function piiHandler(
  deps: AdminControllerDeps,
  { actor, req }: Ctx,
  userId: string,
  reason: string | undefined,
) {
  return revealPii(deps.db, { actor: staffActor(actor, req), userId, reason: requireReason(req, reason) });
}

export async function statusHandler(
  deps: AdminControllerDeps,
  { actor, req }: Ctx,
  userId: string,
  body: z.output<typeof statusBody>,
) {
  return changeUserStatus(deps, {
    actor: staffActor(actor, req),
    userId,
    to: body.status,
    reason: requireReason(req, body.reason),
    evidenceRef: body.evidenceRef,
  });
}

export async function revokeAllHandler(
  deps: AdminControllerDeps,
  { actor, req }: Ctx,
  userId: string,
  reason: string | undefined,
) {
  return revokeUserSessions(deps, {
    actor: staffActor(actor, req),
    userId,
    reason: requireReason(req, reason),
  });
}

export async function auditLogHandler(
  deps: AdminControllerDeps,
  { actor, req }: Ctx,
  userId: string,
  query: { reason?: string | undefined; page: number; limit: number },
) {
  return listUserAuditLog(deps.db, {
    actor: staffActor(actor, req),
    userId,
    reason: requireReason(req, query.reason),
    page: query.page,
    limit: query.limit,
  });
}

export async function linkedAccountsHandler(
  deps: AdminControllerDeps,
  { actor, req }: Ctx,
  userId: string,
  query: { reason?: string | undefined; page: number; limit: number },
) {
  return listLinkedAccounts(deps.db, {
    actor: staffActor(actor, req),
    userId,
    reason: requireReason(req, query.reason),
    page: query.page,
    limit: query.limit,
  });
}

/** 201 either way: a dual-approval role is accepted as a request, and the body says which it was. */
export async function grantRoleHandler(
  deps: AdminControllerDeps,
  { actor, req }: Ctx,
  userId: string,
  body: z.output<typeof grantRoleBody>,
) {
  const staff = staffActor(actor, req);
  const reason = requireReason(req, body.reason);
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;

  const result = await grantRole(deps.db, {
    actor: staff,
    userId,
    roleCode: body.roleCode,
    reason,
    expiresAt,
  });
  if (result.outcome === 'GRANTED') return { status: 'GRANTED' as const, assignmentId: result.assignmentId };

  const opened = await requestApproval(deps.db, {
    actor: staff,
    action: 'ROLE_GRANT',
    subjectUserId: userId,
    reason,
    payload: { roleCode: body.roleCode, expiresAt: result.expiresAt.toISOString() },
  });
  return { status: 'PENDING_APPROVAL' as const, ...opened };
}

export async function revokeRoleHandler(
  deps: AdminControllerDeps,
  { actor, req }: Ctx,
  userId: string,
  roleCode: string,
  reason: string | undefined,
) {
  return revokeRole(deps.db, {
    actor: staffActor(actor, req),
    userId,
    roleCode,
    reason: requireReason(req, reason),
  });
}

export async function reserveHandler(
  deps: AdminControllerDeps,
  { actor, req }: Ctx,
  body: z.output<typeof reserveBody>,
) {
  return reserveUsername(deps.db, {
    actor: staffActor(actor, req),
    username: body.username,
    category: body.category,
    note: body.note,
    reason: requireReason(req, body.reason),
  });
}

export async function requestMfaResetHandler(
  deps: AdminControllerDeps,
  { actor, req }: Ctx,
  userId: string,
  reason: string | undefined,
) {
  return requestApproval(deps.db, {
    actor: staffActor(actor, req),
    action: 'MFA_RESET',
    subjectUserId: userId,
    reason: requireReason(req, reason),
  });
}

export async function requestForceChangeHandler(
  deps: AdminControllerDeps,
  { actor, req }: Ctx,
  userId: string,
  body: z.output<typeof forceChangeBody>,
) {
  return requestApproval(deps.db, {
    actor: staffActor(actor, req),
    action: 'USERNAME_FORCE_CHANGE',
    subjectUserId: userId,
    reason: requireReason(req, body.reason),
    payload: { newUsername: body.newUsername, evidenceRef: body.evidenceRef ?? null },
  });
}

export async function decideHandler(
  deps: AdminControllerDeps,
  { actor, req }: Ctx,
  approvalId: string,
  decision: 'APPROVE' | 'REJECT',
  body: z.output<typeof approveBody>,
) {
  return decideApproval(deps, {
    actor: staffActor(actor, req),
    approvalId,
    decision,
    reason: requireReason(req, body.reason),
    identityChallengeRef: body.identityChallengeRef,
  });
}

export async function approvalsHandler(
  deps: AdminControllerDeps,
  { actor, req }: Ctx,
  query: z.output<typeof approvalsQuery>,
) {
  const staff = staffActor(actor, req);
  const reason = requireReason(req, query.reason);
  const result = await listApprovals(deps.db, {
    state: query.status,
    page: query.page,
    limit: query.limit,
    roles: staff.roles,
  });
  // A list read leaves a row like every other read: who looked at the pending approvals, and why.
  await deps.db.transaction(async (tx) => {
    await auditStaff(tx, staff, {
      action: AUDIT_ACTIONS.ADMIN_APPROVALS_LISTED,
      reason,
      metadata: { status: query.status },
    });
  });
  return result;
}

/** F-051: the signed-in staff member, their live roles and effective permissions. No reason: it is yourself. */
export function staffMeHandler(deps: AdminControllerDeps, { actor }: Pick<Ctx, 'actor'>) {
  const principal = actor.principal;
  if (principal === null) requireUserId(actor, SIGN_IN);
  return getStaffMe(deps.db, principal as NonNullable<typeof principal>);
}
