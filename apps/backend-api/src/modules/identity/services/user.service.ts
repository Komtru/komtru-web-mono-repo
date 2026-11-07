// The one write path for `users.verification_level` above level 1.
//
// M1 §2 splits ownership: identity computes levels 0 and 1 from its own channel verification, and
// M6 computes 2 to 4. M6 §3 D6 has identity SUBSCRIBE to `verification.level_attained` to perform
// the write — this does it in the caller's transaction instead, and the reason is worth stating
// because it is a deliberate deviation:
//
//   the outbox relay makes a subscription eventually consistent, so `GET /verification/status`
//   would answer with the user's OLD level for as long as the relay is behind — which, on the one
//   screen whose entire purpose is to say "you are verified now", is the wrong answer at exactly
//   the wrong moment.
//
// The boundary D6 actually protects is preserved: identity still computes nothing. It is handed a
// level that M6 decided, and it performs the write and publishes the event. The write lands in the
// same transaction as M6's append-only `verification_level_changes` row, so the log and the column
// cannot disagree — which a subscription cannot promise either.
import { and, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { identityVerificationLevelChangedEvent } from '../domain/events.js';
import { isAllowed } from '../domain/rbac/catalog.js';
import { skeletonVariants } from '../domain/username/skeleton.js';
import type { ReservedCategory } from '../domain/username/reserved.js';
import { identityAuditLog } from '../infrastructure/postgres/schema/audit.js';
import { userEmails, userPhones } from '../infrastructure/postgres/schema/contacts.js';
import { userCapabilities } from '../infrastructure/postgres/schema/rbac.js';
import { mfaFactors } from '../infrastructure/postgres/schema/sessions.js';
import { reservedUsernames } from '../infrastructure/postgres/schema/usernames.js';
import { userProfiles, users } from '../infrastructure/postgres/schema/users.js';
import {
  VERIFICATION_LEVELS,
  type userStatus,
  type VerificationLevelName,
} from '../infrastructure/postgres/schema/enums.js';
import { staffPermissionFor } from '../domain/lifecycle.js';
import { AUDIT_ACTIONS } from './audit.service.js';
import { applyStatusTransition, dropEpochCache, type LifecyclePorts } from './lifecycle.service.js';
import { auditStaff, holdsStaffRole, requireAuthorised, type StaffActor } from './rbac.service.js';
import { bumpSessionsEpoch, revokeAllSessions } from './session.service.js';

export interface ApplyVerificationLevelInput {
  userId: string;
  to: VerificationLevelName;
  reason: string;
}

export interface ApplyVerificationLevelResult {
  from: VerificationLevelName;
  to: VerificationLevelName;
  changed: boolean;
}

/**
 * Moves `users.verification_level` to `to`, or does nothing if it is already there.
 *
 * Idempotent on purpose: a redelivered job must not publish a second "you were verified" event, and
 * the level log above this must not grow a row saying a user moved from 2 to 2.
 */
export async function applyVerificationLevel(
  tx: Tx,
  input: ApplyVerificationLevelInput,
): Promise<ApplyVerificationLevelResult> {
  const [row] = await tx
    .select({ verificationLevel: users.verificationLevel })
    .from(users)
    .where(eq(users.id, input.userId))
    .for('update')
    .limit(1);

  if (!row) throw new Error(`identity: no user ${input.userId} to set a verification level on`);
  const from = row.verificationLevel;
  if (from === input.to) return { from, to: input.to, changed: false };

  if (!VERIFICATION_LEVELS.includes(input.to)) {
    throw new RangeError(`identity: "${input.to}" is not a verification level`);
  }

  await tx
    .update(users)
    .set({
      verificationLevel: input.to,
      // The database clock, not the process's: this timestamp is read back by M6's status endpoint
      // and by compliance exports, and two API instances with drifting clocks would order them wrong.
      verificationSyncedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, input.userId));

  await publish(tx, identityVerificationLevelChangedEvent, {
    payload: { userId: input.userId, from, to: input.to },
    aggregateType: 'user',
    aggregateId: input.userId,
  });

  return { from, to: input.to, changed: true };
}

// ---------------------------------------------------------------------------
// T-037: what staff do to a user (M1 section 10.6). Each function writes exactly one audit row with
// the stated reason, inside the transaction of the thing it describes. Route-level permission is
// enforced by the platform before any of these run; `requireAuthorised` here is the second gate for
// the actions where a condition or separation-of-duties rule applies.
// ---------------------------------------------------------------------------

export type UserStatusName = (typeof userStatus.enumValues)[number];

export interface AdminUserSummary {
  id: string;
  publicId: string;
  username: string | null;
  status: UserStatusName;
  verificationLevel: VerificationLevelName;
  createdAt: Date;
}

export interface Pagination {
  page: number;
  limit: number;
}

const summaryColumns = {
  id: users.id,
  publicId: users.publicId,
  username: users.username,
  status: users.status,
  verificationLevel: users.verificationLevel,
  createdAt: users.createdAt,
};

const notFound = (): ApiError => new ApiError(404, 'NOT_FOUND', 'No such user');

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (character) => `\\${character}`);

/**
 * `GET /admin/users?q=&status=&verificationLevel=&page=`. `q` matches a handle by prefix or a public
 * id exactly and nothing else: searching by email or phone would make this list a PII lookup, and
 * that is `user.view_pii`'s job. No contact detail is ever returned.
 */
export async function searchUsers(
  db: Db,
  input: {
    actor: StaffActor;
    reason: string;
    q?: string | undefined;
    status?: UserStatusName | undefined;
    verificationLevel?: VerificationLevelName | undefined;
  } & Pagination,
): Promise<{ items: AdminUserSummary[]; page: number; limit: number; total: number }> {
  const filters: SQL[] = [];
  const q = input.q?.trim().replace(/^@/, '');
  if (q) {
    filters.push(
      /^KMT-U-/i.test(q) ? eq(users.publicId, q.toUpperCase()) : ilike(users.username, `${escapeLike(q)}%`),
    );
  }
  if (input.status) filters.push(eq(users.status, input.status));
  if (input.verificationLevel) filters.push(eq(users.verificationLevel, input.verificationLevel));
  const where = filters.length > 0 ? and(...filters) : undefined;

  return db.transaction(async (tx) => {
    // Sequential: one transaction is one connection, and a pg client queues what it is
    // handed concurrently (deprecated, and an error from pg 9).
    const items = await tx
      .select(summaryColumns)
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(input.limit)
      .offset((input.page - 1) * input.limit);
    const count = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(where);
    await auditStaff(tx, input.actor, {
      action: AUDIT_ACTIONS.ADMIN_USER_SEARCHED,
      reason: input.reason,
      metadata: {
        hasQuery: Boolean(q),
        status: input.status ?? null,
        verificationLevel: input.verificationLevel ?? null,
        page: input.page,
      },
    });
    return { items, page: input.page, limit: input.limit, total: count[0]?.n ?? 0 };
  });
}

export interface AdminUserDetail extends AdminUserSummary {
  statusReason: string | null;
  statusChangedAt: Date;
  mfaEnrolled: boolean;
  capabilities: { capability: string; status: string }[];
}

/** `GET /admin/users/{id}`: everything about the account except what `user.view_pii` guards. */
export async function getUserDetail(
  db: Db,
  input: { actor: StaffActor; userId: string; reason: string },
): Promise<AdminUserDetail> {
  // A status reason can say why someone was restricted, which is closer to personal data than to an
  // account fact. Roles that cannot see PII or act on status (ANALYST, READ_ONLY) do not get it.
  const mayReadStatusReason = (
    ['user.view_pii', 'user.restrict', 'user.suspend', 'user.reinstate'] as const
  ).some((permission) => isAllowed(input.actor.roles, permission));
  return db.transaction(async (tx) => {
    const row = (
      await tx
        .select({
          ...summaryColumns,
          statusReason: users.statusReason,
          statusChangedAt: users.statusChangedAt,
        })
        .from(users)
        .where(eq(users.id, input.userId))
    )[0];
    if (!row) throw notFound();
    // Sequential: one transaction is one connection, and a pg client queues what it is
    // handed concurrently (deprecated, and an error from pg 9).
    const capabilities = await tx
      .select({ capability: userCapabilities.capability, status: userCapabilities.status })
      .from(userCapabilities)
      .where(eq(userCapabilities.userId, input.userId));
    const factors = await tx
      .select({ id: mfaFactors.id })
      .from(mfaFactors)
      .where(and(eq(mfaFactors.userId, input.userId), eq(mfaFactors.status, 'ACTIVE')))
      .limit(1);
    await auditStaff(tx, input.actor, {
      action: AUDIT_ACTIONS.ADMIN_USER_VIEWED,
      subjectUserId: input.userId,
      reason: input.reason,
    });
    return {
      ...row,
      statusReason: mayReadStatusReason ? row.statusReason : null,
      mfaEnrolled: factors.length > 0,
      capabilities,
    };
  });
}

export const PII_FIELDS = ['email', 'phone', 'firstName', 'lastName', 'dateOfBirth'] as const;
export type PiiField = (typeof PII_FIELDS)[number];

/**
 * `GET /admin/users/{id}/pii`. Authorised with the footnote conditions (a support agent needs an
 * open ticket on this user, which nothing can yet supply, so today they are refused) and written
 * as one audit row PER FIELD revealed, as M1 section 12.3 note 1 asks.
 */
export async function revealPii(
  db: Db,
  input: {
    actor: StaffActor;
    userId: string;
    reason: string;
    ticket?: { open: boolean; referencesSubject: boolean };
  },
): Promise<Partial<Record<PiiField, string>>> {
  await requireAuthorised(
    db,
    input.actor,
    {
      permission: 'user.view_pii',
      subjectUserId: input.userId,
      ...(input.ticket ? { ticket: input.ticket } : {}),
    },
    input.reason,
  );

  return db.transaction(async (tx) => {
    if ((await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId))).length === 0) {
      throw notFound();
    }
    // Sequential: one transaction is one connection, and a pg client queues what it is
    // handed concurrently (deprecated, and an error from pg 9).
    const email = await tx
      .select({ value: userEmails.email })
      .from(userEmails)
      .where(and(eq(userEmails.userId, input.userId), eq(userEmails.isPrimary, true)));
    const phone = await tx
      .select({ value: userPhones.phoneE164 })
      .from(userPhones)
      .where(and(eq(userPhones.userId, input.userId), eq(userPhones.isPrimary, true)));
    const profile = await tx
      .select({
        firstName: userProfiles.firstName,
        lastName: userProfiles.lastName,
        dateOfBirth: userProfiles.dateOfBirth,
      })
      .from(userProfiles)
      .where(eq(userProfiles.userId, input.userId));

    const revealed: Partial<Record<PiiField, string>> = {};
    const put = (field: PiiField, value: string | null | undefined) => {
      if (value) revealed[field] = value;
    };
    put('email', email[0]?.value);
    put('phone', phone[0]?.value);
    put('firstName', profile[0]?.firstName);
    put('lastName', profile[0]?.lastName);
    put('dateOfBirth', profile[0]?.dateOfBirth);

    // The field NAME goes in the audit row, never its value (section S12).
    const fields = Object.keys(revealed);
    for (const field of fields.length > 0 ? fields : [null]) {
      await auditStaff(tx, input.actor, {
        action: AUDIT_ACTIONS.ADMIN_PII_VIEWED,
        subjectUserId: input.userId,
        reason: input.reason,
        metadata: { field },
      });
    }
    return revealed;
  });
}

export const STAFF_SETTABLE_STATUSES: readonly string[] = ['RESTRICTED', 'SUSPENDED', 'ACTIVE', 'CLOSED'];

export interface StatusChangeDeps {
  db: Db;
  epochs?: { invalidate(userId: string): Promise<void> };
  /** T-039: the trade check behind a staff closure. Absent means "a trade is open" (fail closed). */
  ports?: LifecyclePorts;
}

/**
 * `POST /admin/users/{id}/status`. Restrict, suspend, reinstate and (T-039) close. The machine
 * itself is `applyStatusTransition`; this adds the staff half: the permission for the target status
 * and the dual-control rules `requireAuthorised` applies. Suspension and closure are M1 D5's kill
 * switch in the same transaction: epoch bump and every session revoked. Locking is a risk rule's
 * (`lockAccount`) and anonymising is the erasure procedure's, so neither is reachable here.
 */
export async function changeUserStatus(
  deps: StatusChangeDeps,
  input: {
    actor: StaffActor;
    userId: string;
    to: UserStatusName;
    reason: string;
    evidenceRef?: string | undefined;
  },
): Promise<{ from: UserStatusName; to: UserStatusName }> {
  const permission = staffPermissionFor(input.to);
  if (!permission) {
    throw new ApiError(
      400,
      'VALIDATION_FAILED',
      'That status cannot be set here',
      `Staff may set ${STAFF_SETTABLE_STATUSES.join(', ')}; locking is a risk rule's and anonymising is the erasure procedure's.`,
    );
  }
  await requireAuthorised(
    deps.db,
    input.actor,
    { permission, subjectUserId: input.userId, subjectIsStaff: await holdsStaffRole(deps.db, input.userId) },
    input.reason,
  );

  const result = await deps.db.transaction((tx) =>
    applyStatusTransition(tx, deps.ports ?? {}, {
      userId: input.userId,
      to: input.to,
      by: 'STAFF',
      reason: input.reason,
      actor: {
        type: 'STAFF',
        userId: input.actor.userId,
        sessionId: input.actor.sessionId,
        ip: input.actor.ip,
        userAgent: input.actor.userAgent,
      },
      auditAction: AUDIT_ACTIONS.ADMIN_STATUS_CHANGED,
      auditMetadata: { evidenceRef: input.evidenceRef ?? null },
    }),
  );

  if (result.killedSessions) await dropEpochCache(deps.epochs, input.userId);
  return { from: result.from, to: result.to };
}

/** `POST /admin/users/{id}/sessions/revoke-all`. */
export async function revokeUserSessions(
  deps: StatusChangeDeps,
  input: { actor: StaffActor; userId: string; reason: string },
): Promise<{ revoked: number }> {
  await requireAuthorised(
    deps.db,
    input.actor,
    {
      permission: 'session.revoke',
      subjectUserId: input.userId,
      subjectIsStaff: await holdsStaffRole(deps.db, input.userId),
    },
    input.reason,
  );
  const revoked = await deps.db.transaction(async (tx) => {
    if ((await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId))).length === 0) {
      throw notFound();
    }
    await bumpSessionsEpoch(tx, input.userId);
    const count = await revokeAllSessions(tx, { userId: input.userId, reason: 'revoked by staff' });
    await auditStaff(tx, input.actor, {
      action: AUDIT_ACTIONS.ADMIN_SESSIONS_REVOKED,
      subjectUserId: input.userId,
      reason: input.reason,
      metadata: { revoked: count },
    });
    return count;
  });
  await deps.epochs?.invalidate(input.userId).catch(() => undefined);
  return { revoked };
}

export interface AuditEntryView {
  id: number;
  occurredAt: Date;
  action: string;
  outcome: string;
  actorType: string;
  actorUserId: string | null;
  metadata: unknown;
}

/** `GET /admin/users/{id}/audit-log`, newest first. Viewing it is itself audited, after the read. */
export async function listUserAuditLog(
  db: Db,
  input: { actor: StaffActor; userId: string; reason: string } & Pagination,
): Promise<{ items: AuditEntryView[]; page: number; limit: number; total: number }> {
  return db.transaction(async (tx) => {
    if ((await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId))).length === 0) {
      throw notFound();
    }
    const where = eq(identityAuditLog.subjectUserId, input.userId);
    // Sequential: one transaction is one connection, and a pg client queues what it is
    // handed concurrently (deprecated, and an error from pg 9).
    const items = await tx
      .select({
        id: identityAuditLog.id,
        occurredAt: identityAuditLog.occurredAt,
        action: identityAuditLog.action,
        outcome: identityAuditLog.outcome,
        actorType: identityAuditLog.actorType,
        actorUserId: identityAuditLog.actorUserId,
        metadata: identityAuditLog.metadata,
      })
      .from(identityAuditLog)
      .where(where)
      .orderBy(desc(identityAuditLog.occurredAt), desc(identityAuditLog.id))
      .limit(input.limit)
      .offset((input.page - 1) * input.limit);
    const count = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(identityAuditLog)
      .where(where);
    await auditStaff(tx, input.actor, {
      action: AUDIT_ACTIONS.ADMIN_AUDIT_LOG_VIEWED,
      subjectUserId: input.userId,
      reason: input.reason,
      metadata: { page: input.page },
    });
    return { items, page: input.page, limit: input.limit, total: count[0]?.n ?? 0 };
  });
}

/**
 * How far back a shared IP counts as a link. Without a bound the self-join grows with every session
 * either account ever opened, and a carrier-grade NAT address links half a city.
 */
export const IP_LINK_WINDOW_DAYS = 90;

export interface LinkedAccountView {
  userId: string;
  publicId: string;
  username: string | null;
  status: string;
  via: 'DEVICE' | 'IP';
  shared: number;
}

/**
 * `GET /admin/users/{id}/linked-accounts`: other accounts that signed in from the same device
 * fingerprint or the same IP. Payout instruments are M8's, so that third link is not here yet.
 */
export async function listLinkedAccounts(
  db: Db,
  input: { actor: StaffActor; userId: string; reason: string } & Pagination,
): Promise<{ items: LinkedAccountView[]; page: number; limit: number; total: number }> {
  return db.transaction(async (tx) => {
    if ((await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId))).length === 0) {
      throw notFound();
    }
    const links = sql`
      SELECT other.user_id AS user_id, 'DEVICE'::text AS via, count(DISTINCT mine.device_fingerprint)::int AS shared
        FROM identity.devices mine
        JOIN identity.devices other
          ON other.device_fingerprint = mine.device_fingerprint AND other.user_id <> mine.user_id
       WHERE mine.user_id = ${input.userId}::uuid
       GROUP BY other.user_id
      UNION ALL
      SELECT other.user_id, 'IP'::text, count(DISTINCT mine.ip)::int
        FROM identity.sessions mine
        JOIN identity.sessions other ON other.ip = mine.ip AND other.user_id <> mine.user_id
                                    AND other.issued_at > now() - interval '${sql.raw(String(IP_LINK_WINDOW_DAYS))} days'
       WHERE mine.user_id = ${input.userId}::uuid AND mine.ip IS NOT NULL
         AND mine.issued_at > now() - interval '${sql.raw(String(IP_LINK_WINDOW_DAYS))} days'
       GROUP BY other.user_id`;
    const total = (await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM (${links}) l`)).rows[0]
      ?.n;
    const { rows } = await tx.execute<{
      user_id: string;
      public_id: string;
      username: string | null;
      status: string;
      via: 'DEVICE' | 'IP';
      shared: number;
    }>(sql`
      SELECT l.user_id, u.public_id, u.username::text AS username, u.status::text AS status, l.via, l.shared
        FROM (${links}) l
        JOIN identity.users u ON u.id = l.user_id
       ORDER BY l.shared DESC, l.via, l.user_id
       LIMIT ${input.limit} OFFSET ${(input.page - 1) * input.limit}`);
    await auditStaff(tx, input.actor, {
      action: AUDIT_ACTIONS.ADMIN_LINKED_ACCOUNTS_VIEWED,
      subjectUserId: input.userId,
      reason: input.reason,
      metadata: { page: input.page },
    });
    return {
      items: rows.map((row) => ({
        userId: row.user_id,
        publicId: row.public_id,
        username: row.username,
        status: row.status,
        via: row.via,
        shared: row.shared,
      })),
      page: input.page,
      limit: input.limit,
      total: total ?? 0,
    };
  });
}

/**
 * `POST /admin/usernames/reserve`. Keyed on the skeleton, with every fold of the handle, so
 * reserving `admin` reserves `adm1n` too. Idempotent: reserving a reserved handle changes nothing.
 */
export async function reserveUsername(
  db: Db,
  input: {
    actor: StaffActor;
    username: string;
    category: ReservedCategory;
    note?: string | undefined;
    reason: string;
  },
): Promise<{ username: string; skeletons: number }> {
  const username = input.username.trim().replace(/^@/, '').toLowerCase();
  const skeletons = skeletonVariants(username);
  return db.transaction(async (tx) => {
    await tx
      .insert(reservedUsernames)
      .values(
        skeletons.map((usernameSkeleton) => ({
          usernameSkeleton,
          category: input.category,
          ...(input.note ? { note: input.note } : {}),
        })),
      )
      .onConflictDoNothing();
    await auditStaff(tx, input.actor, {
      action: AUDIT_ACTIONS.USERNAME_RESERVED,
      reason: input.reason,
      metadata: { username, category: input.category, skeletons: skeletons.length },
    });
    return { username, skeletons: skeletons.length };
  });
}
