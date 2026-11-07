// T-039: the NDPA hooks of M1 §15.
//
//   requestDataExport   POST /me/data-export     a receipt and an event; compliance (T-104) builds the archive
//   requestErasure      POST /me/erasure-request closes the account, then hands off to compliance
//   anonymiseUser       the §15 procedure        one transaction; never a DELETE of the users row
//
// Erasure is "anonymise, never delete": financial and dispute records must survive, so the row stays
// and its foreign keys with it, and only the personal identifiers are replaced. The audit log is
// deliberately untouched. It is the record of the erasure itself, holds user ids and no personal
// data (§S12), and is kept seven years.
//
// What is NOT here. T-104 (compliance) does not exist, so the hand-offs are events and nothing more,
// and no job runs `anonymiseUser`: the legal-hold decision that must precede it is compliance's, not
// identity's (plan, owner decision 9). It is exported for T-104 to call.
import { and, eq, gt, sql } from 'drizzle-orm';
import { pgErrorIn } from '../../../db/errors.js';
import { ApiError } from '../../../platform/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import {
  identityAccountAnonymisedEvent,
  identityDataExportRequestedEvent,
  identityErasureRequestedEvent,
} from '../domain/events.js';
import { CLOSED_RETENTION_DAYS } from '../domain/lifecycle.js';
import { skeleton } from '../domain/username/skeleton.js';
import { identityAuditLog } from '../infrastructure/postgres/schema/audit.js';
import { userEmails, userPhones } from '../infrastructure/postgres/schema/contacts.js';
import { socialIdentities, userCredentials } from '../infrastructure/postgres/schema/credentials.js';
import { partyInvitations } from '../infrastructure/postgres/schema/invitations.js';
import {
  devices,
  mfaFactors,
  otpChallenges,
  passkeyCredentials,
} from '../infrastructure/postgres/schema/sessions.js';
import { usernameHistory } from '../infrastructure/postgres/schema/usernames.js';
import { userProfiles, users } from '../infrastructure/postgres/schema/users.js';
import { anonymiseUserAddresses } from './address.service.js';
import { AUDIT_ACTIONS, writeAudit } from './audit.service.js';
import {
  applyStatusTransition,
  assertNoActiveTrades,
  closeOwnAccount,
  dropEpochCache,
  type CloseDeps,
  type CloseInput,
} from './lifecycle.service.js';
import { holdsStaffRole } from './rbac.service.js';

const DAY_MS = 86_400_000;
/** M1 §15: a data-subject access request has a 30-day SLA. */
export const DSR_SLA_DAYS = 30;
/** A repeat request inside this window returns the first one's receipt (plan, owner decision 11). */
const DUPLICATE_WINDOW_HOURS = 24;

export interface NdpaDeps extends CloseDeps {
  /**
   * Files' `tombstoneByUploader`, wired by the registry (identity cannot import files: files imports
   * identity). Runs AFTER the anonymisation commits; absent or failing, the committed
   * `identity.account.anonymised` event is the retry hook.
   */
  tombstoneUserFiles?: (input: {
    userId: string;
    avatarFileId: string | null;
    reason: string;
  }) => Promise<string[]>;
}

// ---------------------------------------------------------------------------
// POST /me/data-export
// ---------------------------------------------------------------------------

export interface DataExportReceipt {
  outcome: 'REQUESTED' | 'ALREADY_REQUESTED';
  requestedAt: string;
  dueBy: string;
}

export async function requestDataExport(
  deps: Pick<NdpaDeps, 'db'>,
  input: { userId: string; sessionId?: string | undefined; ip?: string | null; userAgent?: string | null },
): Promise<DataExportReceipt> {
  return deps.db.transaction(async (tx) => {
    // The per-user row lock turns the duplicate check below into a real one: two taps on a bad
    // connection would otherwise both read "none yet" and both emit.
    const locked = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .for('update');
    if (locked.length === 0) throw new ApiError(404, 'NOT_FOUND', 'User not found');

    const earlier = (
      await tx
        .select({ at: identityAuditLog.occurredAt })
        .from(identityAuditLog)
        .where(
          and(
            eq(identityAuditLog.subjectUserId, input.userId),
            eq(identityAuditLog.action, AUDIT_ACTIONS.DATA_EXPORT_REQUESTED),
            gt(identityAuditLog.occurredAt, sql`now() - make_interval(hours => ${DUPLICATE_WINDOW_HOURS})`),
          ),
        )
        .orderBy(sql`${identityAuditLog.occurredAt} DESC`)
        .limit(1)
    )[0];
    if (earlier) {
      return {
        outcome: 'ALREADY_REQUESTED' as const,
        requestedAt: earlier.at.toISOString(),
        dueBy: new Date(earlier.at.getTime() + DSR_SLA_DAYS * DAY_MS).toISOString(),
      };
    }

    // The database's transaction clock, so the receipt equals the audit row's `occurred_at` that the
    // duplicate check above reads back; the process's clock would differ by a few milliseconds.
    const clock = await tx.execute<{ ms: string }>(
      sql`SELECT floor(extract(epoch FROM now()) * 1000)::bigint AS ms`,
    );
    const now = new Date(Number(clock.rows[0]?.ms));
    const dueBy = new Date(now.getTime() + DSR_SLA_DAYS * DAY_MS);
    await publish(tx, identityDataExportRequestedEvent, {
      payload: { userId: input.userId, requestedAt: now.toISOString(), dueBy: dueBy.toISOString() },
      aggregateType: 'identity.user',
      aggregateId: input.userId,
      actor: { type: 'CONSUMER', id: input.userId },
    });
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.DATA_EXPORT_REQUESTED,
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: input.userId,
      subjectUserId: input.userId,
      sessionId: input.sessionId ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      metadata: { dueBy: dueBy.toISOString() },
    });
    return { outcome: 'REQUESTED' as const, requestedAt: now.toISOString(), dueBy: dueBy.toISOString() };
  });
}

// ---------------------------------------------------------------------------
// POST /me/erasure-request
// ---------------------------------------------------------------------------

export interface ErasureReceipt {
  scheduledFor: string;
}

/**
 * Closes the account (same proof, same trade check, same kill switch as `POST /me/close`) and, in
 * the SAME transaction, hands the request to compliance. The closure and the event commit together:
 * there is no state where the account is closed and compliance never heard, nor one where compliance
 * heard about an account that is still open and trading.
 */
export async function requestErasure(deps: NdpaDeps, input: CloseInput): Promise<ErasureReceipt> {
  const scheduledFor = new Date(Date.now() + CLOSED_RETENTION_DAYS * DAY_MS).toISOString();
  await closeOwnAccount(deps, input, async (tx) => {
    await publish(tx, identityErasureRequestedEvent, {
      payload: { userId: input.userId, scheduledFor },
      aggregateType: 'identity.user',
      aggregateId: input.userId,
      actor: { type: 'CONSUMER', id: input.userId },
    });
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.ERASURE_REQUESTED,
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: input.userId,
      subjectUserId: input.userId,
      sessionId: input.sessionId ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      metadata: { scheduledFor },
    });
  });
  return { scheduledFor };
}

// ---------------------------------------------------------------------------
// M1 §15: the anonymisation procedure.
// ---------------------------------------------------------------------------

export interface AnonymiseInput {
  userId: string;
  /**
   * COMPLIANCE: T-104 fulfilled a deletion request, having already weighed any legal hold, so the
   * wait is over. RETENTION: only once the closed account has been kept for the full period.
   */
  trigger: 'COMPLIANCE' | 'RETENTION';
}

export interface AnonymiseResult {
  /** False when the account was already anonymised: nothing was done. */
  anonymised: boolean;
  /** True when the files port ran and returned. False is "retry from the event", never a rollback. */
  filesTombstoned: boolean;
}

const TOMBSTONE_ATTEMPTS = 3;
const UNIQUE_VIOLATION = '23505';

/** `deleted_` plus 12 lowercase hex characters, which `^[a-z][a-z0-9._]{2,29}$` accepts. */
const tombstoneHandle = (): string => {
  let hex = '';
  for (const byte of globalThis.crypto.getRandomValues(new Uint8Array(6)))
    hex += byte.toString(16).padStart(2, '0');
  return `deleted_${hex}`;
};

const retentionNotElapsed = (): ApiError =>
  new ApiError(
    409,
    'CONFLICT',
    'This account is still inside its retention period',
    `A closed account is kept for ${CLOSED_RETENTION_DAYS} days before it is anonymised`,
  );

async function runProcedure(
  tx: Tx,
  deps: NdpaDeps,
  input: AnonymiseInput,
): Promise<{ done: false } | { done: true; avatarFileId: string | null; anonymisedAt: Date }> {
  const row = (
    await tx
      .select({
        status: users.status,
        closedAt: users.closedAt,
        username: users.username,
        retentionElapsed: sql<boolean>`${users.closedAt} IS NOT NULL
          AND ${users.closedAt} <= now() - make_interval(days => ${CLOSED_RETENTION_DAYS})`,
      })
      .from(users)
      .where(eq(users.id, input.userId))
      .for('update')
  )[0];
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'User not found');
  if (row.status === 'ANONYMISED') return { done: false };
  if (row.status !== 'CLOSED') {
    throw new ApiError(
      409,
      'INVALID_TRANSITION',
      'That status change is not allowed',
      `An account that is ${row.status} cannot become ANONYMISED`,
    );
  }
  if (input.trigger === 'RETENTION' && !row.retentionElapsed) throw retentionNotElapsed();

  // A staff member's row carries role grants and approvals other people's audit trail points at.
  // Deny by default: that is a human decision, not a job's.
  if (await holdsStaffRole(tx, input.userId)) {
    throw new ApiError(409, 'CONFLICT', 'This account holds a staff role', 'Revoke the role first');
  }
  await assertNoActiveTrades(tx, deps.ports ?? {}, input.userId);

  // Step 1: retire the real handle BEFORE overwriting it, so it can never be re-claimed and inherit
  // the account's history.
  await tx.execute(sql`
    INSERT INTO identity.reserved_usernames (username_skeleton, category, note)
    SELECT username_skeleton, 'SYSTEM', 'retired by anonymisation'
      FROM identity.users WHERE id = ${input.userId} AND username_skeleton IS NOT NULL
    ON CONFLICT (username_skeleton) DO NOTHING`);

  // The status, the kill switch (epoch bump and every session revoked outright), the event and the
  // audit row: the machine's own transaction step, so this path cannot drift from the others.
  await applyStatusTransition(tx, deps.ports ?? {}, {
    userId: input.userId,
    to: 'ANONYMISED',
    by: 'SYSTEM',
    reason: input.trigger === 'COMPLIANCE' ? 'erasure fulfilled by compliance' : 'retention period elapsed',
    actor: { type: 'SYSTEM' },
    auditAction: AUDIT_ACTIONS.ACCOUNT_ANONYMISED,
    auditMetadata: { trigger: input.trigger },
    onlyFrom: ['CLOSED'],
  });

  // Step 2: replace the identifiers. The tombstone handle goes through skeleton(), never string
  // concatenation, so its skeleton cannot collide with a real user's folded one.
  const username = tombstoneHandle();
  await tx
    .update(users)
    .set({
      username,
      usernameSkeleton: skeleton(username),
      anonymisedAt: sql`now()`,
      primaryEmailId: null,
      primaryPhoneId: null,
      registrationIp: null,
      consentIp: null,
      lastLoginAt: null,
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, input.userId));

  // Step 3: destroy credentials, channels and authenticators.
  await tx.delete(userEmails).where(eq(userEmails.userId, input.userId));
  await tx.delete(userPhones).where(eq(userPhones.userId, input.userId));
  await tx.delete(socialIdentities).where(eq(socialIdentities.userId, input.userId));
  await tx.delete(userCredentials).where(eq(userCredentials.userId, input.userId));
  await tx.delete(devices).where(eq(devices.userId, input.userId));
  await tx.delete(passkeyCredentials).where(eq(passkeyCredentials.userId, input.userId));
  await tx.delete(mfaFactors).where(eq(mfaFactors.userId, input.userId));
  await tx.delete(otpChallenges).where(eq(otpChallenges.userId, input.userId));
  await tx.delete(usernameHistory).where(eq(usernameHistory.userId, input.userId));

  // Step 5: strip recoverable destinations from invitations this user sent. `destination_enc` is
  // NOT NULL, so "stripped" is the empty value rather than NULL.
  await tx
    .update(partyInvitations)
    .set({ destinationEnc: Buffer.alloc(0), destinationMasked: '•••' })
    .where(eq(partyInvitations.inviterUserId, input.userId));

  // Step 6: scrub the profile, remembering the avatar reference (the file itself is tombstoned
  // after the commit, through files).
  const profile = (
    await tx
      .select({ avatarFileId: userProfiles.avatarFileId })
      .from(userProfiles)
      .where(eq(userProfiles.userId, input.userId))
      .for('update')
  )[0];
  await tx
    .update(userProfiles)
    .set({
      displayName: 'Deleted User',
      firstName: null,
      lastName: null,
      avatarFileId: null,
      bio: null,
      dateOfBirth: null,
      gender: null,
      updatedAt: sql`now()`,
    })
    .where(eq(userProfiles.userId, input.userId));

  // T-042: saved addresses are scrubbed and archived, never deleted (a trade snapshots them).
  await anonymiseUserAddresses(tx, input.userId);

  const anonymisedAt = new Date();
  await publish(tx, identityAccountAnonymisedEvent, {
    payload: { userId: input.userId, anonymisedAt: anonymisedAt.toISOString() },
    aggregateType: 'identity.user',
    aggregateId: input.userId,
  });

  return { done: true, avatarFileId: profile?.avatarFileId ?? null, anonymisedAt };
}

/**
 * Runs M1 §15 as a single transaction. Idempotent: an anonymised account returns
 * `{ anonymised: false }` and changes nothing, so a redelivered compliance message is harmless.
 */
export async function anonymiseUser(deps: NdpaDeps, input: AnonymiseInput): Promise<AnonymiseResult> {
  let outcome: Awaited<ReturnType<typeof runProcedure>> | undefined;
  for (let attempt = 1; ; attempt += 1) {
    try {
      outcome = await deps.db.transaction((tx) => runProcedure(tx, deps, input));
      break;
    } catch (error) {
      // Only a tombstone-handle collision is transient (48 random bits, so this is theory). Every
      // other failure rolled the whole procedure back and is the caller's to see.
      if (pgErrorIn(error)?.code !== UNIQUE_VIOLATION || attempt >= TOMBSTONE_ATTEMPTS) throw error;
    }
  }
  if (!outcome.done) return { anonymised: false, filesTombstoned: false };

  await dropEpochCache(deps.epochs, input.userId);

  // After the commit: files' calls use their own connection and queue a provider destroy, neither of
  // which belongs inside, or should be able to roll back, a database transaction.
  let filesTombstoned = false;
  if (deps.tombstoneUserFiles) {
    try {
      await deps.tombstoneUserFiles({
        userId: input.userId,
        avatarFileId: outcome.avatarFileId,
        reason: 'account anonymised (M1 §15)',
      });
      filesTombstoned = true;
    } catch (error) {
      deps.logger.error(
        { userId: input.userId, err: error },
        'identity: anonymised, but the files tombstone failed; retry from identity.account.anonymised',
      );
    }
  }
  return { anonymised: true, filesTombstoned };
}
