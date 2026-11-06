// Two-step actions through `admin_action_approvals` (T-037, M1 sections 10.6 and 12.3 note 3).
//
// One holder REQUESTS, a different holder APPROVES, and only then does anything happen. Holding the
// permission is what lets you request; the second signature is what lets it run. The same table
// carries every two-step action on the platform (M6's override and M8's refunds route through it
// rather than inventing a parallel mechanism), so this file separates the two kinds:
//
//   - identity-owned actions (MFA reset, forced username change, and the dual-approval role grant)
//     run INSIDE the approving transaction, so the approval and its effect commit together;
//   - foreign actions (verification override, refunds) are only approved here, and the owning module
//     spends the approval with `consumeApproval` in its own transaction, exactly once.
//
// The database backs the distinctness rules with CHECK constraints (`admin_action_distinct_approver`
// and `admin_action_self_approval`); everything here refuses first, with a reason.
import { and, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { identityAdminActionApprovalRequestedEvent, identityMfaRemovedEvent } from '../domain/events.js';
import { isAllowed, type PermissionCode } from '../domain/rbac/catalog.js';
import {
  TWO_STEP_ACTIONS,
  approvalSatisfies,
  type ApprovalProof,
  type TwoStepAction,
} from '../domain/rbac/sod.js';
import { adminActionApprovals } from '../infrastructure/postgres/schema/rbac.js';
import { mfaFactors, passkeyCredentials } from '../infrastructure/postgres/schema/sessions.js';
import { users } from '../infrastructure/postgres/schema/users.js';
import { AUDIT_ACTIONS } from './audit.service.js';
import {
  auditStaff,
  forbidden,
  insertAssignment,
  isDualApprovalRole,
  liveRoleCodes,
  refuse,
  type StaffActor,
} from './rbac.service.js';
import { bumpSessionsEpoch, revokeAllSessions } from './session.service.js';
import { changeUsername } from './username.service.js';

/** The two-step registry plus the dual-approval role grant, which needs a second approver too. */
export type ApprovalAction = TwoStepAction | 'ROLE_GRANT';

const ROLE_GRANT_PERMISSION: PermissionCode = 'role.grant';

export const APPROVAL_ACTIONS: readonly ApprovalAction[] = [
  ...(Object.keys(TWO_STEP_ACTIONS) as TwoStepAction[]),
  'ROLE_GRANT',
];

/** How long an approver has. A stale request must be made again by someone who still wants it. */
export const APPROVAL_TTL_HOURS = 24;

export const permissionFor = (action: ApprovalAction): PermissionCode =>
  action === 'ROLE_GRANT' ? ROLE_GRANT_PERMISSION : TWO_STEP_ACTIONS[action].permission;

const isApprovalAction = (value: string): value is ApprovalAction =>
  (APPROVAL_ACTIONS as readonly string[]).includes(value);

const identityOwned = (action: ApprovalAction): boolean =>
  action === 'ROLE_GRANT' || TWO_STEP_ACTIONS[action].identityOwned;

export interface ApprovalDeps {
  db: Db;
  /** Best-effort cache invalidation after a commit that bumped a user's epoch. */
  epochs?: { invalidate(userId: string): Promise<void> };
}

const notFound = () => new ApiError(404, 'NOT_FOUND', 'No such approval');
const conflict = (detail: string) => new ApiError(409, 'CONFLICT', 'Conflict', detail);

export interface RequestApprovalInput {
  actor: StaffActor;
  action: ApprovalAction;
  subjectUserId: string;
  reason: string;
  payload?: Record<string, unknown> | undefined;
}

/** Inserts the request and its audit row and event. Callers authorise first. */
export async function openApproval(
  tx: Tx,
  input: RequestApprovalInput,
): Promise<{ approvalId: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + APPROVAL_TTL_HOURS * 60 * 60 * 1000);
  const row = (
    await tx
      .insert(adminActionApprovals)
      .values({
        action: input.action,
        subjectUserId: input.subjectUserId,
        requestedBy: input.actor.userId,
        reason: input.reason,
        payload: input.payload ?? null,
        expiresAt,
      })
      .returning({ id: adminActionApprovals.id })
  )[0];
  if (!row) throw new Error('openApproval: the insert returned no row');

  await auditStaff(tx, input.actor, {
    action: AUDIT_ACTIONS.APPROVAL_REQUESTED,
    subjectUserId: input.subjectUserId,
    reason: input.reason,
    metadata: { approvalId: row.id, approvalAction: input.action },
  });
  await publish(tx, identityAdminActionApprovalRequestedEvent, {
    payload: { approvalId: row.id, action: input.action, subjectUserId: input.subjectUserId },
    aggregateType: 'identity.admin_action',
    aggregateId: row.id,
    actor: { type: 'STAFF', id: input.actor.userId },
  });
  return { approvalId: row.id, expiresAt };
}

/**
 * Requests a two-step action. The requester must HOLD the permission (the grant's own condition is
 * for the approval to settle), may not target their own account, and the subject must exist.
 */
export async function requestApproval(
  db: Db,
  input: RequestApprovalInput,
): Promise<{ approvalId: string; expiresAt: Date }> {
  const permission = permissionFor(input.action);
  const denied = !isAllowed(input.actor.roles, permission)
    ? 'PERMISSION_DENIED'
    : input.subjectUserId === input.actor.userId
      ? 'SELF_ACTION'
      : undefined;
  if (denied) {
    return refuse(db, input.actor, {
      permission,
      subjectUserId: input.subjectUserId,
      reason: input.reason,
      denied,
    });
  }

  return db.transaction(async (tx) => {
    const subject = (
      await tx.select({ id: users.id }).from(users).where(eq(users.id, input.subjectUserId)).limit(1)
    )[0];
    if (!subject) throw new ApiError(404, 'NOT_FOUND', 'No such user');
    return openApproval(tx, input);
  });
}

type ApprovalRow = typeof adminActionApprovals.$inferSelect;

export type ApprovalState = 'PENDING' | 'APPROVED' | 'EXECUTED' | 'REJECTED' | 'EXPIRED';

export const approvalState = (row: ApprovalRow, now = new Date()): ApprovalState =>
  row.rejectedAt !== null
    ? 'REJECTED'
    : row.executedAt !== null
      ? 'EXECUTED'
      : row.approvedAt !== null
        ? 'APPROVED'
        : row.expiresAt.getTime() <= now.getTime()
          ? 'EXPIRED'
          : 'PENDING';

export interface DecideInput {
  actor: StaffActor;
  approvalId: string;
  decision: 'APPROVE' | 'REJECT';
  reason: string;
  /** The identity challenge with the subject was completed (MFA reset only; ignored elsewhere). */
  identityChallengeConfirmed?: boolean | undefined;
}

export interface DecideResult {
  approvalId: string;
  state: 'EXECUTED' | 'APPROVED' | 'REJECTED';
  action: ApprovalAction;
}

/**
 * Approves or rejects. Approving re-checks EVERYTHING at the moment of approval — the requester must
 * still hold the permission, the approver must be a different person from requester and subject who
 * holds it, and the identity challenge must be attested where the action calls for one — and then,
 * for an identity-owned action, performs it in the same transaction.
 */
export async function decideApproval(deps: ApprovalDeps, input: DecideInput): Promise<DecideResult> {
  const { db } = deps;
  const { actor } = input;

  const outcome = await db.transaction(async (tx): Promise<DecideResult & { invalidate: string[] }> => {
    const row = (
      await tx
        .select()
        .from(adminActionApprovals)
        .where(eq(adminActionApprovals.id, input.approvalId))
        .for('update')
    )[0];
    if (!row || !isApprovalAction(row.action)) throw notFound();

    const state = approvalState(row);
    if (state === 'EXPIRED') throw conflict('This approval has expired; ask for it again');
    if (state !== 'PENDING') throw conflict(`This approval is already ${state.toLowerCase()}`);

    const action = row.action;
    const permission = permissionFor(action);
    if (!isAllowed(actor.roles, permission)) throw forbidden();

    if (input.decision === 'REJECT') {
      await tx
        .update(adminActionApprovals)
        .set({ rejectedAt: sql`now()`, rejectionReason: input.reason })
        .where(eq(adminActionApprovals.id, row.id));
      await auditStaff(tx, actor, {
        action: AUDIT_ACTIONS.APPROVAL_REJECTED,
        subjectUserId: row.subjectUserId,
        reason: input.reason,
        metadata: { approvalId: row.id, approvalAction: action },
      });
      return { approvalId: row.id, state: 'REJECTED', action, invalidate: [] };
    }

    const proof: ApprovalProof = {
      approvedByUserId: actor.userId,
      approvedByRoles: actor.roles,
      identityChallengeConfirmed: input.identityChallengeConfirmed === true,
    };
    const requesterRoles = await liveRoleCodes(tx, row.requestedBy);
    const requesterStillHolds = isAllowed(requesterRoles, permission);
    if (
      !requesterStillHolds ||
      !approvalSatisfies({
        permission,
        requesterUserId: row.requestedBy,
        subjectUserId: row.subjectUserId,
        proof,
      })
    ) {
      throw forbidden(
        !requesterStillHolds
          ? 'The requester no longer holds the permission for this action'
          : 'You cannot approve this: you must be a different person from the requester and the subject, hold the permission, and have completed the identity challenge where one is required',
      );
    }

    const invalidate: string[] = [];
    let executed = false;
    if (identityOwned(action)) {
      invalidate.push(...(await execute(tx, row, action, input.reason, actor.userId)));
      executed = true;
    }

    await tx
      .update(adminActionApprovals)
      .set({
        approvedBy: actor.userId,
        approvedAt: sql`now()`,
        ...(executed ? { executedAt: sql`now()` } : {}),
      })
      .where(eq(adminActionApprovals.id, row.id));

    // ONE row for approve-and-execute: the action is a single staff decision, and its effect is
    // named in the metadata rather than written as a second row.
    await auditStaff(tx, actor, {
      action: AUDIT_ACTIONS.APPROVAL_APPROVED,
      subjectUserId: row.subjectUserId,
      reason: input.reason,
      metadata: {
        approvalId: row.id,
        approvalAction: action,
        requestedBy: row.requestedBy,
        executed,
        identityChallengeConfirmed: proof.identityChallengeConfirmed,
      },
    });
    return { approvalId: row.id, state: executed ? 'EXECUTED' : 'APPROVED', action, invalidate };
  });

  // After the commit and best-effort, as `applyKillSwitch` does: a missed invalidation costs one
  // cache hit, because `resolvePrincipal` compares the token's epoch with the row it just read.
  for (const userId of outcome.invalidate) await deps.epochs?.invalidate(userId).catch(() => undefined);
  return { approvalId: outcome.approvalId, state: outcome.state, action: outcome.action };
}

/** Performs an identity-owned action. Returns the user ids whose epoch moved. */
async function execute(
  tx: Tx,
  row: ApprovalRow,
  action: ApprovalAction,
  reason: string,
  approverUserId: string,
): Promise<string[]> {
  const payload = (row.payload ?? {}) as Record<string, unknown>;

  switch (action) {
    case 'MFA_RESET': {
      const factors = await tx
        .update(mfaFactors)
        .set({ revokedAt: sql`now()`, status: 'REVOKED', isDefault: false })
        .where(and(eq(mfaFactors.userId, row.subjectUserId), isNull(mfaFactors.revokedAt)))
        .returning({ id: mfaFactors.id, type: mfaFactors.factorType });
      await tx
        .update(passkeyCredentials)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(passkeyCredentials.userId, row.subjectUserId), isNull(passkeyCredentials.revokedAt)));
      await tx
        .update(users)
        .set({ mfaEnrolledAt: null, updatedAt: sql`now()` })
        .where(eq(users.id, row.subjectUserId));
      // A reset exists because someone else may hold the factor, so every session goes with it.
      await bumpSessionsEpoch(tx, row.subjectUserId);
      await revokeAllSessions(tx, { userId: row.subjectUserId, reason: 'mfa reset by staff' });
      for (const [index, factor] of factors.entries()) {
        await publish(tx, identityMfaRemovedEvent, {
          payload: {
            userId: row.subjectUserId,
            factorId: factor.id,
            factorType: factor.type,
            lastFactor: index === factors.length - 1,
          },
          aggregateType: 'identity.user',
          aggregateId: row.subjectUserId,
          actor: { type: 'STAFF', id: row.requestedBy },
        });
      }
      return [row.subjectUserId];
    }

    case 'USERNAME_FORCE_CHANGE': {
      const newUsername = payload.newUsername;
      if (typeof newUsername !== 'string') throw conflict('The request carries no new handle');
      // `changeUsername` opens its own transaction; handed a transaction it nests as a savepoint, so
      // the change commits or rolls back with the approval.
      await changeUsername(
        { db: tx },
        {
          userId: row.subjectUserId,
          username: newUsername,
          reason,
          actorUserId: row.requestedBy,
          forced: true,
        },
      );
      return [];
    }

    case 'ROLE_GRANT': {
      const roleCode = payload.roleCode;
      if (typeof roleCode !== 'string' || !isDualApprovalRole(roleCode)) {
        throw conflict('The request carries no dual-approval role');
      }
      const expiresAt = typeof payload.expiresAt === 'string' ? new Date(payload.expiresAt) : undefined;
      await insertAssignment(tx, {
        userId: row.subjectUserId,
        roleCode,
        grantedBy: row.requestedBy,
        approvedBy: approverUserId,
        reason: row.reason,
        expiresAt,
      });
      return [];
    }

    default:
      throw conflict('That action is carried out by the module that owns it');
  }
}

export interface ConsumeApprovalInput {
  approvalId: string;
  action: TwoStepAction;
  subjectUserId: string;
  /** Who is spending it. Must not be the approver: the approver signs, someone else acts. */
  consumedBy: string;
}

/**
 * How a module that owns a foreign two-step action (verification override, refund) spends an
 * approval: once, in its own transaction, for the action and subject it was approved for. Anything
 * else — wrong action, wrong subject, not approved, expired, already spent — refuses.
 */
export async function consumeApproval(tx: Tx, input: ConsumeApprovalInput): Promise<void> {
  const row = (
    await tx
      .select()
      .from(adminActionApprovals)
      .where(eq(adminActionApprovals.id, input.approvalId))
      .for('update')
  )[0];
  if (!row || row.action !== input.action || row.subjectUserId !== input.subjectUserId) {
    throw new ApiError(404, 'NOT_FOUND', 'No such approval');
  }
  if (row.approvedAt === null || row.approvedBy === null || row.rejectedAt !== null) {
    throw forbidden('This action has not been approved');
  }
  if (row.executedAt !== null) throw conflict('This approval has already been used');
  if (row.expiresAt.getTime() <= Date.now()) throw conflict('This approval has expired');
  if (row.approvedBy === input.consumedBy) throw forbidden('The approver cannot also be the one who acts');

  await tx
    .update(adminActionApprovals)
    .set({ executedAt: sql`now()` })
    .where(eq(adminActionApprovals.id, row.id));
}

export interface ApprovalView {
  id: string;
  action: string;
  state: ApprovalState;
  subjectUserId: string;
  requestedBy: string;
  approvedBy: string | null;
  reason: string;
  requestedAt: Date;
  approvedAt: Date | null;
  executedAt: Date | null;
  expiresAt: Date;
  rejectedAt: Date | null;
}

const view = (row: ApprovalRow): ApprovalView => ({
  id: row.id,
  action: row.action,
  state: approvalState(row),
  subjectUserId: row.subjectUserId,
  requestedBy: row.requestedBy,
  approvedBy: row.approvedBy,
  reason: row.reason,
  requestedAt: row.requestedAt,
  approvedAt: row.approvedAt,
  executedAt: row.executedAt,
  expiresAt: row.expiresAt,
  rejectedAt: row.rejectedAt,
});

const stateFilter = (state: ApprovalState): SQL =>
  state === 'PENDING'
    ? sql`${isNull(adminActionApprovals.approvedAt)} AND ${isNull(adminActionApprovals.rejectedAt)} AND ${adminActionApprovals.expiresAt} > now()`
    : state === 'EXPIRED'
      ? sql`${isNull(adminActionApprovals.approvedAt)} AND ${isNull(adminActionApprovals.rejectedAt)} AND ${adminActionApprovals.expiresAt} <= now()`
      : state === 'APPROVED'
        ? sql`${isNotNull(adminActionApprovals.approvedAt)} AND ${isNull(adminActionApprovals.executedAt)}`
        : state === 'EXECUTED'
          ? sql`${isNotNull(adminActionApprovals.executedAt)}`
          : sql`${isNotNull(adminActionApprovals.rejectedAt)}`;

/**
 * `GET /admin/approvals?status=PENDING`, newest first, paged. A caller sees only the approvals for
 * actions whose permission they hold: the list is what they could request or settle, and a finance
 * admin has no business reading the queue of MFA resets.
 */
export async function listApprovals(
  db: Db,
  input: { state: ApprovalState; page: number; limit: number; roles: readonly string[] },
): Promise<{ items: ApprovalView[]; page: number; limit: number; total: number }> {
  const visible = APPROVAL_ACTIONS.filter((action) => isAllowed(input.roles, permissionFor(action)));
  if (visible.length === 0) return { items: [], page: input.page, limit: input.limit, total: 0 };
  const where = and(stateFilter(input.state), inArray(adminActionApprovals.action, visible));
  const [rows, count] = await Promise.all([
    db
      .select()
      .from(adminActionApprovals)
      .where(where)
      .orderBy(desc(adminActionApprovals.requestedAt), desc(adminActionApprovals.id))
      .limit(input.limit)
      .offset((input.page - 1) * input.limit),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(adminActionApprovals)
      .where(where),
  ]);
  return { items: rows.map(view), page: input.page, limit: input.limit, total: count[0]?.n ?? 0 };
}
