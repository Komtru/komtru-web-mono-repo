// Staff roles at the service layer (T-037): who holds what right now, the authorisation every admin
// action runs through, and time-boxed and dual-approved role grants.
//
// `resolvePrincipal` already decides what a REQUEST may do from live grants (route-level permission).
// What lives here is the second gate: the conditions and separation-of-duties rules the catalogue
// cannot express (`domain/rbac/sod.ts`), and the writes to `admin_role_assignments`.
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { identityAdminRoleGrantedEvent, identityAdminRoleRevokedEvent } from '../domain/events.js';
import { isKnownRole } from '../domain/rbac/catalog.js';
import {
  DUAL_APPROVAL_ROLES,
  authorizeAdminAction,
  validateRoleGrant,
  type AdminActionInput,
  type DenyReason,
} from '../domain/rbac/sod.js';
import { adminRoleAssignments, roles } from '../infrastructure/postgres/schema/rbac.js';
import { sessions } from '../infrastructure/postgres/schema/sessions.js';
import { users } from '../infrastructure/postgres/schema/users.js';
import { AUDIT_ACTIONS, writeAudit } from './audit.service.js';

/** The caller of an admin endpoint, as `resolvePrincipal` re-read it from the database this request. */
export interface StaffActor {
  userId: string;
  roles: readonly string[];
  sessionId?: string | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
}

export const forbidden = (detail = 'You do not have permission to do that'): ApiError =>
  new ApiError(403, 'FORBIDDEN', 'You do not have permission to do that', detail);

/** The audit row of a staff action. `reason` is mandatory and non-empty: M1 section 10.6. */
export async function auditStaff(
  tx: Tx,
  actor: StaffActor,
  input: {
    action: string;
    subjectUserId?: string | null;
    reason: string;
    outcome?: 'SUCCESS' | 'DENIED';
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (input.reason.trim().length === 0) throw new Error('auditStaff: a staff action needs a reason');
  await writeAudit(tx, {
    action: input.action,
    outcome: input.outcome ?? 'SUCCESS',
    actorType: 'STAFF',
    actorUserId: actor.userId,
    subjectUserId: input.subjectUserId ?? null,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
    sessionId: actor.sessionId ?? null,
    metadata: { reason: input.reason, ...input.metadata },
  });
}

const DENIAL_DETAIL: Record<DenyReason, string> = {
  PERMISSION_DENIED: 'You do not have permission to do that',
  CONDITION_NOT_MET: 'This needs a condition you have not met (an open ticket, a documented request)',
  APPROVAL_REQUIRED: 'This needs a second approver',
  SELF_ACTION: 'You cannot do this to your own account',
  SELF_DEALING: 'You are connected to this trade and cannot action it',
};

/**
 * Runs `authorizeAdminAction` and, on a refusal, records a DENIED audit row before raising the 403.
 *
 * The row is written through `db` and NOT the caller's transaction, deliberately: the caller's
 * transaction is about to roll back on the throw, and an audit trail that loses the refusal along
 * with the work it refused is not one.
 */
export async function requireAuthorised(
  db: Db,
  actor: StaffActor,
  input: Omit<AdminActionInput, 'actorUserId' | 'roles'>,
  reason: string,
): Promise<void> {
  const verdict = authorizeAdminAction({ ...input, actorUserId: actor.userId, roles: actor.roles });
  if (verdict.allowed) return;
  await refuse(db, actor, {
    permission: input.permission,
    subjectUserId: input.subjectUserId,
    reason,
    denied: verdict.reason,
  });
}

/** Records the refusal and raises it. Exported for the approval service's own prechecks. */
export async function refuse(
  db: Db,
  actor: StaffActor,
  input: { permission: string; subjectUserId?: string | undefined; reason: string; denied: DenyReason },
): Promise<never> {
  await db.transaction((tx) =>
    auditStaff(tx, actor, {
      action: AUDIT_ACTIONS.ADMIN_ACTION_DENIED,
      subjectUserId: input.subjectUserId ?? null,
      reason: input.reason,
      outcome: 'DENIED',
      metadata: { permission: input.permission, denied: input.denied },
    }),
  );
  throw forbidden(DENIAL_DETAIL[input.denied]);
}

/** Live role codes: not revoked, not past `expires_at`, and approved where the role demands it. */
export async function liveRoleCodes(tx: Pick<Db, 'select'>, userId: string): Promise<string[]> {
  const rows = await tx
    .select({ code: adminRoleAssignments.roleCode })
    .from(adminRoleAssignments)
    .innerJoin(roles, eq(roles.code, adminRoleAssignments.roleCode))
    .where(
      and(
        eq(adminRoleAssignments.userId, userId),
        isNull(adminRoleAssignments.revokedAt),
        sql`(${adminRoleAssignments.expiresAt} IS NULL OR ${adminRoleAssignments.expiresAt} > now())`,
        sql`(NOT ${roles.requiresDualApproval} OR ${adminRoleAssignments.approvedBy} IS NOT NULL)`,
      ),
    );
  return [...new Set(rows.map((row) => row.code))];
}

const userExists = async (tx: Tx, userId: string): Promise<boolean> =>
  (await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1)).length > 0;

const notFound = (what = 'user') => new ApiError(404, 'NOT_FOUND', `No such ${what}`);

const conflict = (detail: string) => new ApiError(409, 'CONFLICT', 'Conflict', detail);

const grantRefusal = (reason: string): ApiError =>
  reason === 'UNKNOWN_ROLE'
    ? new ApiError(404, 'NOT_FOUND', 'No such role')
    : reason === 'INVALID_EXPIRY'
      ? new ApiError(
          400,
          'VALIDATION_FAILED',
          'Invalid expiry',
          'expiresAt must be in the future and within a year',
        )
      : reason === 'SELF_GRANT'
        ? forbidden('You cannot grant a role to yourself')
        : forbidden('The approver must be a different person from the granter and the grantee');

export interface InsertAssignmentInput {
  userId: string;
  roleCode: string;
  grantedBy: string;
  approvedBy?: string | undefined;
  reason: string;
  expiresAt?: Date | undefined;
}

/**
 * The write behind a grant, shared by the single-step path and by the approval that completes a
 * dual-approval grant. Re-validates, so an approval executed a day after it was requested still
 * refuses an expiry that has since passed. Writes no audit row: the caller owns the one row.
 */
export async function insertAssignment(tx: Tx, input: InsertAssignmentInput): Promise<string> {
  const verdict = validateRoleGrant({
    roleCode: input.roleCode,
    userId: input.userId,
    grantedBy: input.grantedBy,
    ...(input.approvedBy ? { approvedBy: input.approvedBy } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    now: new Date(),
  });
  if (!verdict.ok) throw grantRefusal(verdict.reason);
  if (verdict.needsSecondApprover) throw new Error('insertAssignment: a dual-approval role needs approvedBy');

  const active = await tx
    .select({ id: adminRoleAssignments.id, expiresAt: adminRoleAssignments.expiresAt })
    .from(adminRoleAssignments)
    .where(
      and(
        eq(adminRoleAssignments.userId, input.userId),
        eq(adminRoleAssignments.roleCode, input.roleCode),
        isNull(adminRoleAssignments.revokedAt),
      ),
    )
    .for('update');
  // An EXPIRED row still occupies the partial unique index, so a re-grant after expiry would hit
  // it. It is no longer authorising anything, so close it out as expired rather than refuse.
  for (const row of active) {
    if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) {
      await tx
        .update(adminRoleAssignments)
        .set({ revokedAt: sql`now()`, revokeReason: 'expired' })
        .where(eq(adminRoleAssignments.id, row.id));
    } else {
      throw conflict('This user already holds that role');
    }
  }

  const row = (
    await tx
      .insert(adminRoleAssignments)
      .values({
        userId: input.userId,
        roleCode: input.roleCode,
        grantedBy: input.grantedBy,
        approvedBy: input.approvedBy ?? null,
        reason: input.reason,
        expiresAt: input.expiresAt ?? null,
      })
      .returning({ id: adminRoleAssignments.id })
  )[0];
  if (!row) throw new Error('insertAssignment: the insert returned no row');

  await publish(tx, identityAdminRoleGrantedEvent, {
    payload: {
      userId: input.userId,
      roleCode: input.roleCode,
      grantedBy: input.grantedBy,
      approvedBy: input.approvedBy ?? null,
      expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
    },
    aggregateType: 'identity.user',
    aggregateId: input.userId,
    actor: { type: 'STAFF', id: input.grantedBy },
  });
  return row.id;
}

export type GrantRoleResult = { outcome: 'GRANTED'; assignmentId: string } | { outcome: 'NEEDS_APPROVAL' };

/**
 * `POST /admin/users/{id}/roles`, first half. A role that does not need a second approver is
 * granted here and now; one of FINANCE_ADMIN, SUPER_ADMIN or COMPLIANCE_OFFICER returns
 * NEEDS_APPROVAL and the caller opens a `ROLE_GRANT` approval (`approval.service`), whose approval
 * performs the grant with `approved_by` set. Nothing here ever writes a dual-approval row alone,
 * and the database trigger would refuse it if it tried.
 */
export async function grantRole(
  db: Db,
  input: {
    actor: StaffActor;
    userId: string;
    roleCode: string;
    reason: string;
    expiresAt?: Date | undefined;
  },
): Promise<GrantRoleResult> {
  const { actor } = input;
  await requireAuthorised(db, actor, { permission: 'role.grant', subjectUserId: input.userId }, input.reason);

  const verdict = validateRoleGrant({
    roleCode: input.roleCode,
    userId: input.userId,
    grantedBy: actor.userId,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    now: new Date(),
  });
  if (!verdict.ok) throw grantRefusal(verdict.reason);

  return db.transaction(async (tx): Promise<GrantRoleResult> => {
    if (!(await userExists(tx, input.userId))) throw notFound();
    if (verdict.needsSecondApprover) return { outcome: 'NEEDS_APPROVAL' };

    const assignmentId = await insertAssignment(tx, {
      userId: input.userId,
      roleCode: input.roleCode,
      grantedBy: actor.userId,
      reason: input.reason,
      expiresAt: input.expiresAt,
    });
    await auditStaff(tx, actor, {
      action: AUDIT_ACTIONS.ROLE_GRANTED,
      subjectUserId: input.userId,
      reason: input.reason,
      metadata: {
        roleCode: input.roleCode,
        assignmentId,
        expiresAt: input.expiresAt?.toISOString() ?? null,
      },
    });
    return { outcome: 'GRANTED', assignmentId };
  });
}

/** `DELETE /admin/users/{id}/roles/{roleCode}`. COMPLIANCE_OFFICER may do this and never the grant. */
export async function revokeRole(
  db: Db,
  input: { actor: StaffActor; userId: string; roleCode: string; reason: string },
): Promise<{ revokedAt: Date; staffSessionsRevoked: number }> {
  const { actor } = input;
  await requireAuthorised(
    db,
    actor,
    { permission: 'role.revoke', subjectUserId: input.userId },
    input.reason,
  );
  if (!isKnownRole(input.roleCode)) throw notFound('role');

  return db.transaction(async (tx) => {
    const revoked = (
      await tx
        .update(adminRoleAssignments)
        .set({
          revokedAt: sql`now()`,
          revokedBy: actor.userId,
          revokeReason: input.reason,
        })
        .where(
          and(
            eq(adminRoleAssignments.userId, input.userId),
            eq(adminRoleAssignments.roleCode, input.roleCode),
            isNull(adminRoleAssignments.revokedAt),
          ),
        )
        .returning({ id: adminRoleAssignments.id, revokedAt: adminRoleAssignments.revokedAt })
    )[0];
    if (!revoked?.revokedAt) throw notFound('active role grant');

    // With no live role left, a STAFF session has nothing to stand on: end it now rather than leave
    // a session that authorises nothing and has to wait out its idle timeout.
    let staffSessionsRevoked = 0;
    if ((await liveRoleCodes(tx, input.userId)).length === 0) {
      staffSessionsRevoked = (
        await tx
          .update(sessions)
          .set({ revokedAt: sql`now()`, revokeReason: 'staff role revoked' })
          .where(
            and(eq(sessions.userId, input.userId), eq(sessions.scope, 'STAFF'), isNull(sessions.revokedAt)),
          )
          .returning({ id: sessions.id })
      ).length;
    }

    await auditStaff(tx, actor, {
      action: AUDIT_ACTIONS.ROLE_REVOKED,
      subjectUserId: input.userId,
      reason: input.reason,
      metadata: { roleCode: input.roleCode, assignmentId: revoked.id, staffSessionsRevoked },
    });
    await publish(tx, identityAdminRoleRevokedEvent, {
      payload: {
        userId: input.userId,
        roleCode: input.roleCode,
        revokedBy: actor.userId,
        reason: input.reason,
      },
      aggregateType: 'identity.user',
      aggregateId: input.userId,
      actor: { type: 'STAFF', id: actor.userId },
    });
    return { revokedAt: revoked.revokedAt, staffSessionsRevoked };
  });
}

export const isDualApprovalRole = (roleCode: string): boolean =>
  (DUAL_APPROVAL_ROLES as readonly string[]).includes(roleCode);
