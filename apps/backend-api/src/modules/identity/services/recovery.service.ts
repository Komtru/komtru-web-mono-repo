// T-039: account recovery (M1 §5.8, §11).
//
// The highest-risk flow in the module, and the one social engineering targets. Three rules:
//
//   1. The intake answers the same way for a known and an unknown identifier (§S3). An unknown one
//      is stored (so the volume is visible) but opens no ticket and is closed at once.
//   2. A human decides. `RECOVERY_HUMAN_REVIEW_THRESHOLD` is 0, so no request completes without a
//      reviewer, and the reviewer is never the account the request is about.
//   3. Approval does as little as is safe: it unlocks a LOCKED account and signs every device out.
//      It does NOT reset a password or remove an MFA factor. Those stay with the password reset flow
//      and T-037's two-person MFA reset (plan, owner decision 8).
//
// M10 (tickets, T-100) is not built: "opens a support ticket" is the `recovery_requested` event.
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { publish } from '../../../platform/events/publish.js';
import type { HmacHasher } from '../../../platform/crypto/hmac.js';
import { identityRecoveryCompletedEvent, identityRecoveryRequestedEvent } from '../domain/events.js';
import type { RecoveryMethod } from '../domain/events.js';
import {
  RECOVERY_HUMAN_REVIEW_THRESHOLD,
  RECOVERY_REQUEST_TTL_DAYS,
  recoveryNeedsHuman,
  recoveryRiskScore,
} from '../domain/recovery.js';
import { accountRecoveryRequests } from '../infrastructure/postgres/schema/sessions.js';
import { users } from '../infrastructure/postgres/schema/users.js';
import { AUDIT_ACTIONS, writeAudit } from './audit.service.js';
import {
  applyStatusTransition,
  dropEpochCache,
  type EpochInvalidator,
  type LifecyclePorts,
} from './lifecycle.service.js';
import { resolveLoginCandidate } from './login.service.js';
import { holdsStaffRole, requireAuthorised, type StaffActor } from './rbac.service.js';
import { bumpSessionsEpoch, revokeAllSessions } from './session.service.js';

const OPEN_STATUSES = ['PENDING', 'CHALLENGED'] as const;

export interface RecoveryDeps {
  db: Db;
  /** The module's pepper-bound hasher: the claimed identifier is stored as a digest, never as text. */
  hasher: HmacHasher;
  ports?: LifecyclePorts;
  epochs?: EpochInvalidator;
  /** Defaults to the shipped threshold. A test, or M13 later, may pass another. */
  reviewThreshold?: number;
}

export interface RecoveryIntake {
  identifier: string;
  method: RecoveryMethod;
  /** M20 file ids the requester uploaded as proof. Soft references: not resolved here. */
  evidenceRefs?: readonly string[];
  ip?: string | null;
  deviceId?: string | null;
}

/** The same body for every outcome. */
export interface RecoveryReceipt {
  requestId: string;
  status: 'RECEIVED';
}

const IDENTIFIER_DOMAIN = 'recovery-identifier';

/**
 * `POST /auth/recovery-requests`. Public; the route rate-limits by identifier and IP.
 */
export async function requestRecovery(deps: RecoveryDeps, input: RecoveryIntake): Promise<RecoveryReceipt> {
  const claimedIdentifierHash = deps.hasher.hmac(IDENTIFIER_DOMAIN, input.identifier.trim().toLowerCase());
  const evidence = [...(input.evidenceRefs ?? [])];

  return deps.db.transaction(async (tx): Promise<RecoveryReceipt> => {
    const candidate = await resolveLoginCandidate(tx, input.identifier);

    // Unknown identifier: remember that it was asked (volume is a signal), open nothing, and answer
    // exactly as for a known one.
    if (!candidate) {
      const [row] = await tx
        .insert(accountRecoveryRequests)
        .values({
          userId: null,
          claimedIdentifierHash,
          method: input.method,
          status: 'REJECTED',
          decisionReason: 'NO_SUCH_ACCOUNT',
          requiresHuman: false,
          evidenceRefs: evidence,
          requestedIp: input.ip ?? null,
          requestedDeviceId: input.deviceId ?? null,
          expiresAt: sql`now()`,
        })
        .returning({ id: accountRecoveryRequests.id });
      return { requestId: row?.id ?? '', status: 'RECEIVED' };
    }

    // One open request per account. A second would be a second ticket for the same incident, and a
    // way to flood the review queue by retrying.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, candidate.userId)).for('update');
    const open = (
      await tx
        .select({ id: accountRecoveryRequests.id })
        .from(accountRecoveryRequests)
        .where(
          and(
            eq(accountRecoveryRequests.userId, candidate.userId),
            inArray(accountRecoveryRequests.status, [...OPEN_STATUSES]),
            sql`${accountRecoveryRequests.expiresAt} > now()`,
          ),
        )
        .limit(1)
    )[0];
    if (open) return { requestId: open.id, status: 'RECEIVED' };

    const riskScore = recoveryRiskScore({
      method: input.method,
      hasEvidence: evidence.length > 0,
      accountStatus: candidate.status,
      holdsStaffRole: await holdsStaffRole(tx, candidate.userId),
    });
    const requiresHuman = recoveryNeedsHuman(
      riskScore,
      deps.reviewThreshold ?? RECOVERY_HUMAN_REVIEW_THRESHOLD,
    );

    const [created] = await tx
      .insert(accountRecoveryRequests)
      .values({
        userId: candidate.userId,
        claimedIdentifierHash,
        method: input.method,
        // Below the threshold the request waits for the self-recovery OTP flow; it is never approved
        // here without a reviewer.
        status: requiresHuman ? 'PENDING' : 'CHALLENGED',
        evidenceRefs: evidence,
        riskScore,
        requiresHuman,
        requestedIp: input.ip ?? null,
        requestedDeviceId: input.deviceId ?? null,
        expiresAt: sql`now() + make_interval(days => ${RECOVERY_REQUEST_TTL_DAYS})`,
      })
      .returning({ id: accountRecoveryRequests.id });
    const requestId = created?.id ?? '';

    await publish(tx, identityRecoveryRequestedEvent, {
      payload: {
        recoveryRequestId: requestId,
        userId: candidate.userId,
        method: input.method,
        riskScore,
        requiresHuman,
        evidenceCount: evidence.length,
      },
      aggregateType: 'identity.user',
      aggregateId: candidate.userId,
    });
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.RECOVERY_REQUESTED,
      outcome: 'SUCCESS',
      actorType: 'ANONYMOUS',
      subjectUserId: candidate.userId,
      ip: input.ip ?? null,
      deviceId: input.deviceId ?? null,
      metadata: { recoveryRequestId: requestId, method: input.method, riskScore, requiresHuman },
    });
    return { requestId, status: 'RECEIVED' };
  });
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export interface RecoveryRequestView {
  id: string;
  userId: string;
  method: string;
  status: string;
  riskScore: number | null;
  requiresHuman: boolean;
  evidenceCount: number;
  createdAt: Date;
  expiresAt: Date;
  reviewedBy: string | null;
  decisionReason: string | null;
}

/** The review queue. Never returns the claimed identifier: even its digest is not the reviewer's business. */
export async function listRecoveryRequests(
  db: Db,
  input: { actor: StaffActor; status?: string | undefined; reason: string; page: number; limit: number },
): Promise<{ items: RecoveryRequestView[]; page: number; limit: number; total: number }> {
  return db.transaction(async (tx) => {
    // `userId IS NOT NULL`: a request about an unknown identifier is noise, not a case.
    const where = and(
      sql`${accountRecoveryRequests.userId} IS NOT NULL`,
      input.status ? eq(accountRecoveryRequests.status, input.status) : undefined,
    );
    const rows = await tx
      .select({
        id: accountRecoveryRequests.id,
        userId: accountRecoveryRequests.userId,
        method: accountRecoveryRequests.method,
        status: accountRecoveryRequests.status,
        riskScore: accountRecoveryRequests.riskScore,
        requiresHuman: accountRecoveryRequests.requiresHuman,
        evidenceCount: sql<number>`coalesce(array_length(${accountRecoveryRequests.evidenceRefs}, 1), 0)::int`,
        createdAt: accountRecoveryRequests.createdAt,
        expiresAt: accountRecoveryRequests.expiresAt,
        reviewedBy: accountRecoveryRequests.reviewedBy,
        decisionReason: accountRecoveryRequests.decisionReason,
      })
      .from(accountRecoveryRequests)
      .where(where)
      .orderBy(desc(accountRecoveryRequests.createdAt))
      .limit(input.limit)
      .offset((input.page - 1) * input.limit);
    const total = (
      await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(accountRecoveryRequests)
        .where(where)
    )[0]?.n;

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.ADMIN_RECOVERY_LISTED,
      outcome: 'SUCCESS',
      actorType: 'STAFF',
      actorUserId: input.actor.userId,
      sessionId: input.actor.sessionId ?? null,
      ip: input.actor.ip ?? null,
      userAgent: input.actor.userAgent ?? null,
      metadata: { reason: input.reason, status: input.status ?? null, returned: rows.length },
    });
    return {
      items: rows.map((r) => ({ ...r, userId: r.userId as string })),
      page: input.page,
      limit: input.limit,
      total: total ?? 0,
    };
  });
}

export interface DecideRecoveryInput {
  actor: StaffActor;
  requestId: string;
  decision: 'APPROVE' | 'REJECT';
  reason: string;
}

/**
 * Approve or reject. Reviewing needs `user.reinstate` (plan, owner decision 6) and the usual
 * dual-control rules. The reviewer is never the subject, here and again by the table's CHECK.
 */
export async function decideRecovery(
  deps: RecoveryDeps,
  input: DecideRecoveryInput,
): Promise<{ status: 'COMPLETED' | 'REJECTED'; unlocked: boolean }> {
  const target = (
    await deps.db
      .select({ userId: accountRecoveryRequests.userId })
      .from(accountRecoveryRequests)
      .where(eq(accountRecoveryRequests.id, input.requestId))
      .limit(1)
  )[0];
  // 404 for a missing request AND for one with no account behind it: the latter is not a case.
  if (!target?.userId) throw new ApiError(404, 'NOT_FOUND', 'Recovery request not found');
  const subjectUserId = target.userId;

  await requireAuthorised(
    deps.db,
    input.actor,
    {
      permission: 'user.reinstate',
      subjectUserId,
      subjectIsStaff: await holdsStaffRole(deps.db, subjectUserId),
    },
    input.reason,
  );

  const result = await deps.db.transaction(async (tx) => {
    const request = (
      await tx
        .select()
        .from(accountRecoveryRequests)
        .where(eq(accountRecoveryRequests.id, input.requestId))
        .for('update')
    )[0];
    if (!request?.userId) throw new ApiError(404, 'NOT_FOUND', 'Recovery request not found');
    if (request.userId === input.actor.userId) {
      throw new ApiError(403, 'FORBIDDEN', 'You cannot review a request about your own account');
    }
    const live =
      (OPEN_STATUSES as readonly string[]).includes(request.status) &&
      request.expiresAt.getTime() > Date.now();
    if (!live) {
      throw new ApiError(
        409,
        'INVALID_TRANSITION',
        'That request has already been decided or has expired',
        `The request is ${request.status}`,
      );
    }

    const account = (
      await tx.select({ status: users.status }).from(users).where(eq(users.id, request.userId)).for('update')
    )[0];
    if (!account) throw new ApiError(404, 'NOT_FOUND', 'User not found');

    let unlocked = false;
    if (input.decision === 'APPROVE') {
      // Recovery gives access back to an account that is merely locked or healthy. A suspended,
      // closed or anonymised one is not recovered by proving who you are.
      if (!['ACTIVE', 'PENDING_VERIFICATION', 'RESTRICTED', 'LOCKED'].includes(account.status)) {
        throw new ApiError(
          409,
          'INVALID_TRANSITION',
          'Recovery cannot restore this account',
          `An account that is ${account.status} is not recovered through this flow`,
        );
      }
      if (account.status === 'LOCKED') {
        await applyStatusTransition(tx, deps.ports ?? {}, {
          userId: request.userId,
          to: 'ACTIVE',
          by: 'STAFF',
          reason: `account recovery approved: ${input.reason}`,
          actor: {
            type: 'STAFF',
            userId: input.actor.userId,
            sessionId: input.actor.sessionId,
            ip: input.actor.ip,
            userAgent: input.actor.userAgent,
          },
          auditAction: AUDIT_ACTIONS.ADMIN_STATUS_CHANGED,
          auditMetadata: { recoveryRequestId: request.id },
        });
        unlocked = true;
      }
      // Whoever held the account until now is signed out: it may have been in the wrong hands.
      await bumpSessionsEpoch(tx, request.userId);
      await revokeAllSessions(tx, { userId: request.userId, reason: 'account recovery' });
    }

    const status = input.decision === 'APPROVE' ? ('COMPLETED' as const) : ('REJECTED' as const);
    await tx
      .update(accountRecoveryRequests)
      .set({
        status,
        reviewedBy: input.actor.userId,
        reviewedAt: sql`now()`,
        decisionReason: input.reason,
        ...(status === 'COMPLETED' ? { completedAt: sql`now()` } : {}),
      })
      .where(eq(accountRecoveryRequests.id, request.id));

    await publish(tx, identityRecoveryCompletedEvent, {
      payload: {
        recoveryRequestId: request.id,
        userId: request.userId,
        reviewedBy: input.actor.userId,
        outcome: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      },
      aggregateType: 'identity.user',
      aggregateId: request.userId,
      actor: { type: 'STAFF', id: input.actor.userId },
    });
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.RECOVERY_DECIDED,
      outcome: 'SUCCESS',
      actorType: 'STAFF',
      actorUserId: input.actor.userId,
      subjectUserId: request.userId,
      sessionId: input.actor.sessionId ?? null,
      ip: input.actor.ip ?? null,
      userAgent: input.actor.userAgent ?? null,
      metadata: { reason: input.reason, recoveryRequestId: request.id, decision: input.decision, unlocked },
    });
    return { status, unlocked, userId: request.userId, approved: input.decision === 'APPROVE' };
  });

  if (result.approved) await dropEpochCache(deps.epochs, result.userId);
  return { status: result.status, unlocked: result.unlocked };
}

/** Marks requests nobody decided in time. Daily; bounded so a backlog is not one statement. */
export async function expireRecoveryRequests(db: Db, now: Date = new Date()): Promise<number> {
  const rows = await db
    .update(accountRecoveryRequests)
    .set({ status: 'EXPIRED' })
    .where(
      and(
        inArray(accountRecoveryRequests.status, [...OPEN_STATUSES]),
        lt(accountRecoveryRequests.expiresAt, now),
      ),
    )
    .returning({ id: accountRecoveryRequests.id });
  return rows.length;
}
