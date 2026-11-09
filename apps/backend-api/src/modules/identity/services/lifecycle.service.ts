// T-039: the one write path for `users.status` (M1 §9.1).
//
// `applyStatusTransition` is the whole machine in one function: it locks the row, asks the table in
// domain/lifecycle.ts whether this initiator may make this move, refuses a closure while a trade is
// live, runs M1 D5's kill switch for a status that cannot hold a session, and writes the event and
// the audit row in the same transaction. Staff (`changeUserStatus`), the account holder
// (`closeOwnAccount`), a risk rule (`lockAccount`), a recovery decision (T-039 recovery.service) and
// the sweeps all go through it, so none of them can forget a step.
//
// A status change never cancels in-flight escrow (M1 §9.1's Rule). Closing is therefore refused,
// whoever asks, while the account is a party to a trade that has not reached a terminal state.
import { and, eq, lt, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import type { EventActor } from '@komtru/shared-types';
import { identityUserStatusChangedEvent } from '../domain/events.js';
import {
  ABANDONED_REGISTRATION_DAYS,
  isStatusUsable,
  transitionAllowed,
  type Initiator,
  type LifecycleStatus,
} from '../domain/lifecycle.js';
import { userEmails, userPhones } from '../infrastructure/postgres/schema/contacts.js';
import { users } from '../infrastructure/postgres/schema/users.js';
import type { PasswordHasher } from '../domain/credential/hashing.js';
import { AUDIT_ACTIONS, writeAudit, type AuditActorType } from './audit.service.js';
import { hasCredential, verifyAndRecord, type CredentialDeps } from './credential.service.js';
import { bumpSessionsEpoch, revokeAllSessions } from './session.service.js';

/**
 * What identity needs from other modules to run the machine. Handed in by the registry, because
 * trades imports identity and not the other way round.
 */
export interface LifecyclePorts {
  /**
   * True when the user is a party to any trade that has not reached a terminal state. ABSENT MEANS
   * "YES": a process that was not wired to answer refuses to close rather than closing blind.
   */
  hasActiveTrades?: (db: Db | Tx, userId: string) => Promise<boolean>;
}

export interface EpochInvalidator {
  invalidate(userId: string): Promise<void>;
}

export interface TransitionActor {
  type: AuditActorType;
  userId?: string | null | undefined;
  sessionId?: string | null | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
}

/**
 * What the `identity.user.status_changed` event says about WHY. A code, never the free text: an outbox
 * row is kept, consumers are many, and a staff member's note ("fraud ring 7") or a user's own words
 * are not theirs to read. The full staff text stays in `users.status_reason` and the audit log, which
 * only staff see.
 */
export type StatusReasonCode =
  | 'STAFF_RESTRICT'
  | 'STAFF_SUSPEND'
  | 'STAFF_REINSTATE'
  | 'STAFF_CLOSE'
  | 'SELF_CLOSE'
  | 'RISK_LOCK'
  | 'RECOVERY_APPROVED'
  | 'REGISTRATION_ABANDONED'
  | 'RETENTION_ELAPSED'
  | 'ERASURE_FULFILLED';

export interface TransitionInput {
  userId: string;
  to: LifecycleStatus;
  by: Initiator;
  reason: string;
  reasonCode: StatusReasonCode;
  actor: TransitionActor;
  auditAction: string;
  /** Ids, counts and enum values only (§S12). `reason`, `from`, `to` are added. */
  auditMetadata?: Record<string, unknown>;
  /** Only act if the account is in one of these; anything else is an `INVALID_TRANSITION`, not a no-op. */
  onlyFrom?: readonly LifecycleStatus[];
}

export interface TransitionResult {
  from: LifecycleStatus;
  to: LifecycleStatus;
  sessionsRevoked: number;
  /** True when sessions were killed: the caller drops the epoch cache entry after the commit. */
  killedSessions: boolean;
}

const notFound = (): ApiError => new ApiError(404, 'NOT_FOUND', 'User not found');

const eventActor = (actor: TransitionActor): EventActor => {
  if (actor.type === 'STAFF' && actor.userId) return { type: 'STAFF', id: actor.userId };
  if (actor.type === 'USER' && actor.userId) return { type: 'CONSUMER', id: actor.userId };
  return { type: 'SYSTEM' };
};

export const activeTradesRefusal = (): ApiError =>
  new ApiError(
    409,
    'CONFLICT',
    'This account has trades in progress',
    'Finish or cancel every open trade before closing the account',
    undefined,
    { reason: 'ACTIVE_TRADES' },
  );

/** Fails closed: no port, or a port that says yes, is a refusal. */
export async function assertNoActiveTrades(
  db: Db | Tx,
  ports: LifecyclePorts,
  userId: string,
): Promise<void> {
  const active = ports.hasActiveTrades ? await ports.hasActiveTrades(db, userId) : true;
  if (active) throw activeTradesRefusal();
}

/**
 * Trade creation's half of the close-vs-trade race. `trades.*_user_id` has no foreign key, so
 * inserting a trade takes no lock on the user row, and a closure could read "no active trades",
 * commit, and strand a trade created a moment earlier. Trades calls this inside the transaction that
 * writes a party onto a trade: `FOR SHARE` makes a concurrent closure (which holds `FOR UPDATE` on
 * the same row while it counts trades) wait for the trade to commit, or makes this wait for the
 * closure and then see a non-ACTIVE status and refuse.
 */
export async function lockUserForTrade(tx: Tx, userId: string): Promise<void> {
  const row = (
    await tx.select({ status: users.status }).from(users).where(eq(users.id, userId)).for('share')
  )[0];
  if (row?.status !== 'ACTIVE') {
    throw new ApiError(
      409,
      'CONFLICT',
      'This account cannot take part in a trade right now',
      'The account is not active',
      undefined,
      { reason: 'ACCOUNT_NOT_ACTIVE' },
    );
  }
}

export async function applyStatusTransition(
  tx: Tx,
  ports: LifecyclePorts,
  input: TransitionInput,
): Promise<TransitionResult> {
  const row = (
    await tx.select({ status: users.status }).from(users).where(eq(users.id, input.userId)).for('update')
  )[0];
  if (!row) throw notFound();
  const from = row.status;

  const permitted =
    transitionAllowed(from, input.to, input.by) && (input.onlyFrom ? input.onlyFrom.includes(from) : true);
  if (!permitted) {
    throw new ApiError(
      409,
      'INVALID_TRANSITION',
      'That status change is not allowed',
      `An account that is ${from} cannot become ${input.to}`,
    );
  }

  if (input.to === 'CLOSED') await assertNoActiveTrades(tx, ports, input.userId);

  await tx
    .update(users)
    .set({
      status: input.to,
      statusReason: input.reason,
      statusChangedAt: sql`now()`,
      updatedAt: sql`now()`,
      ...(input.to === 'CLOSED' ? { closedAt: sql`now()` } : {}),
    })
    .where(eq(users.id, input.userId));

  // M1 D5: a status that cannot hold a session must not leave one behind. The epoch alone kills the
  // access tokens and leaves the refresh token able to mint more, so both halves run.
  const killedSessions = !isStatusUsable(input.to);
  let sessionsRevoked = 0;
  if (killedSessions) {
    await bumpSessionsEpoch(tx, input.userId);
    sessionsRevoked = await revokeAllSessions(tx, {
      userId: input.userId,
      reason: `account ${input.to.toLowerCase()}`,
    });
  }

  await publish(tx, identityUserStatusChangedEvent, {
    payload: { userId: input.userId, from, to: input.to, reason: input.reasonCode },
    aggregateType: 'identity.user',
    aggregateId: input.userId,
    actor: eventActor(input.actor),
  });

  await writeAudit(tx, {
    action: input.auditAction,
    outcome: 'SUCCESS',
    actorType: input.actor.type,
    actorUserId: input.actor.userId ?? null,
    subjectUserId: input.userId,
    ip: input.actor.ip ?? null,
    userAgent: input.actor.userAgent ?? null,
    sessionId: input.actor.sessionId ?? null,
    metadata: {
      ...input.auditMetadata,
      reason: input.reason,
      from,
      to: input.to,
      sessionsRevoked,
    },
  });

  return { from, to: input.to, sessionsRevoked, killedSessions };
}

/** After the commit and best-effort: a stale cache entry can never admit a token the row refuses. */
export async function dropEpochCache(epochs: EpochInvalidator | undefined, userId: string): Promise<void> {
  await epochs?.invalidate(userId).catch(() => undefined);
}

export interface LifecycleDeps {
  db: Db;
  ports?: LifecyclePorts;
  epochs?: EpochInvalidator;
}

/**
 * A risk or fraud rule locks an account (M1 §9.1's `status = 'LOCKED'`). System only: there is no
 * staff lock permission in the §12.2 catalogue, and the self-clearing password throttle is a
 * different mechanism that never touches `users.status`.
 */
export async function lockAccount(
  deps: LifecycleDeps,
  input: { userId: string; reason: string; ruleId?: string },
): Promise<TransitionResult> {
  const result = await deps.db.transaction((tx) =>
    applyStatusTransition(tx, deps.ports ?? {}, {
      userId: input.userId,
      to: 'LOCKED',
      by: 'SYSTEM',
      reason: input.reason,
      reasonCode: 'RISK_LOCK',
      actor: { type: 'SYSTEM' },
      auditAction: AUDIT_ACTIONS.ACCOUNT_LOCKED,
      auditMetadata: input.ruleId ? { ruleId: input.ruleId } : {},
    }),
  );
  await dropEpochCache(deps.epochs, input.userId);
  return result;
}

// ---------------------------------------------------------------------------
// CA1 / CA2: the account holder closes their own account.
// ---------------------------------------------------------------------------

export interface CloseDeps extends LifecycleDeps {
  hasher: PasswordHasher;
  breach: CredentialDeps['breach'];
  logger: CredentialDeps['logger'];
  /** §S7's step-up for an account with no password to prove. Optional so unit callers can omit it. */
  requireStepUp?: (tx: Tx, userId: string, token: string | undefined) => Promise<void>;
}

export const CLOSE_REASON_CODES = ['NOT_USING', 'PRIVACY', 'SECURITY', 'OTHER'] as const;
export type CloseReasonCode = (typeof CLOSE_REASON_CODES)[number];

export interface CloseInput {
  userId: string;
  sessionId?: string | undefined;
  reasonCode: CloseReasonCode;
  password?: string | undefined;
  stepUpToken?: string | undefined;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * `POST /me/close`. The password is the proof for an account that has one (a stolen session must not
 * be enough to close someone's account); an account with none presents a step-up token instead.
 * The trade check runs before the password is spent on, so "you have open trades" is answered
 * without burning a lockout attempt.
 */
export async function closeOwnAccount(
  deps: CloseDeps,
  input: CloseInput,
  /** Runs in the closing transaction, so a hand-off event commits with the closure or not at all. */
  onClosed?: (tx: Tx, closed: TransitionResult) => Promise<void>,
): Promise<TransitionResult> {
  const ports = deps.ports ?? {};
  const result = await deps.db.transaction(async (tx) => {
    // The trade refusal first: it is the more useful answer, and it costs the caller no attempt.
    await assertNoActiveTrades(tx, ports, input.userId);

    if (await hasCredential(tx, input.userId)) {
      if (input.password === undefined) {
        throw new ApiError(422, 'VALIDATION_FAILED', 'Your password is required', undefined, [
          { path: 'password', message: 'Enter your password to close the account' },
        ]);
      }
      const verdict = await verifyAndRecord(tx, deps, { userId: input.userId, password: input.password });
      if (verdict.outcome !== 'OK') {
        // A wrong password is committed as a failed attempt by `verifyAndRecord`; throwing would roll
        // it back, so the refusal is returned out of the transaction instead.
        return { refused: true as const };
      }
    } else {
      if (!deps.requireStepUp) {
        throw new ApiError(403, 'STEP_UP_REQUIRED', 'Confirm it is you', 'Complete a step-up challenge');
      }
      await deps.requireStepUp(tx, input.userId, input.stepUpToken);
    }

    const transition = await applyStatusTransition(tx, ports, {
      userId: input.userId,
      to: 'CLOSED',
      by: 'SELF',
      // The user's own words are NOT stored (they may name anyone); only which box they ticked.
      reason: `SELF_CLOSE:${input.reasonCode}`,
      reasonCode: 'SELF_CLOSE',
      actor: {
        type: 'USER',
        userId: input.userId,
        sessionId: input.sessionId,
        ip: input.ip,
        userAgent: input.userAgent,
      },
      auditAction: AUDIT_ACTIONS.ACCOUNT_CLOSED,
    });
    await onClosed?.(tx, transition);
    return { refused: false as const, transition };
  });
  if (result.refused) throw new ApiError(401, 'INVALID_CREDENTIALS', 'That password is not correct');
  await dropEpochCache(deps.epochs, input.userId);
  return result.transition;
}

// ---------------------------------------------------------------------------
// §9.1's PENDING_VERIFICATION -- 30d, no channel verified --> CLOSED.
// ---------------------------------------------------------------------------

/**
 * Closes registrations that never verified a channel within the window. Bounded per run so a backlog
 * is not one transaction; each account is its own transaction so one failure strands nothing else.
 * Re-checks "still no verified channel" under the row lock, because a verification can land between
 * the scan and the close.
 */
export async function sweepAbandonedRegistrations(
  deps: LifecycleDeps,
  options: { now?: Date; limit?: number } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - ABANDONED_REGISTRATION_DAYS * 86_400_000);
  const stale = await deps.db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.status, 'PENDING_VERIFICATION'), lt(users.createdAt, cutoff)))
    .limit(options.limit ?? 500);

  let closed = 0;
  for (const { id } of stale) {
    const done = await deps.db.transaction(async (tx) => {
      const locked = await tx.select({ id: users.id }).from(users).where(eq(users.id, id)).for('update');
      if (locked.length === 0) return false;
      const [email, phone] = await Promise.all([
        tx
          .select({ id: userEmails.id })
          .from(userEmails)
          .where(and(eq(userEmails.userId, id), sql`${userEmails.verifiedAt} IS NOT NULL`))
          .limit(1),
        tx
          .select({ id: userPhones.id })
          .from(userPhones)
          .where(and(eq(userPhones.userId, id), sql`${userPhones.verifiedAt} IS NOT NULL`))
          .limit(1),
      ]);
      if (email.length > 0 || phone.length > 0) return false;
      try {
        await applyStatusTransition(tx, deps.ports ?? {}, {
          userId: id,
          to: 'CLOSED',
          by: 'SYSTEM',
          reason: `no channel verified within ${ABANDONED_REGISTRATION_DAYS} days`,
          reasonCode: 'REGISTRATION_ABANDONED',
          actor: { type: 'SYSTEM' },
          auditAction: AUDIT_ACTIONS.ACCOUNT_CLOSED,
          onlyFrom: ['PENDING_VERIFICATION'],
        });
        return true;
      } catch (error) {
        // Status moved under us, or a trade is somehow attached: leave it for staff, do not fail the run.
        if (error instanceof ApiError) return false;
        throw error;
      }
    });
    if (done) {
      closed += 1;
      await dropEpochCache(deps.epochs, id);
    }
  }
  return closed;
}

// ---------------------------------------------------------------------------
// AS1 / AS2 / CA1: what an account may do, and what its screens need to say.
// ---------------------------------------------------------------------------

/** M1 §9.1's capability table, as data. Withdraw is `restricted`: existing escrow still settles (note 2). */
const STATUS_ABILITIES: Record<
  LifecycleStatus,
  { login: boolean; browse: boolean; buy: boolean; sell: boolean; withdraw: boolean }
> = {
  PENDING_VERIFICATION: { login: true, browse: true, buy: false, sell: false, withdraw: false },
  ACTIVE: { login: true, browse: true, buy: true, sell: true, withdraw: true },
  RESTRICTED: { login: true, browse: true, buy: false, sell: false, withdraw: false },
  SUSPENDED: { login: false, browse: false, buy: false, sell: false, withdraw: false },
  LOCKED: { login: false, browse: false, buy: false, sell: false, withdraw: false },
  CLOSED: { login: false, browse: false, buy: false, sell: false, withdraw: false },
  ANONYMISED: { login: false, browse: false, buy: false, sell: false, withdraw: false },
};

export interface AccountNotice {
  status: LifecycleStatus;
  /** Null for a healthy account. */
  since: string | null;
  abilities: (typeof STATUS_ABILITIES)[LifecycleStatus];
  /** True while a trade is open: AS2 tells a seller that existing trades still follow their normal course. */
  openTrades: boolean | null;
  /** What to quote to support. The public id is safe to expose (M1 §5.2). */
  supportReference: string;
  /** CA1 lists "you cannot close while trades are open" before the user taps. */
  canClose: boolean;
  /**
   * Never the staff-written reason: it may name a fraud signal (plan, owner decision 2). Only a
   * stable key the screens map to copy.
   */
  noticeKey: 'ACCOUNT_RESTRICTED' | 'ACCOUNT_SUSPENDED' | 'ACCOUNT_LOCKED' | 'ACCOUNT_CLOSED' | null;
}

const NOTICE_KEYS: Partial<Record<LifecycleStatus, AccountNotice['noticeKey']>> = {
  RESTRICTED: 'ACCOUNT_RESTRICTED',
  SUSPENDED: 'ACCOUNT_SUSPENDED',
  LOCKED: 'ACCOUNT_LOCKED',
  CLOSED: 'ACCOUNT_CLOSED',
};

/** `GET /me`'s account block: the data behind screens AS1, AS2, CA1 and CA2. */
export async function getAccountNotice(
  db: Db | Tx,
  ports: LifecyclePorts,
  userId: string,
): Promise<AccountNotice> {
  const row = (
    await db
      .select({ status: users.status, publicId: users.publicId, changedAt: users.statusChangedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  if (!row) throw notFound();

  const noticeKey = NOTICE_KEYS[row.status] ?? null;
  const openTrades = ports.hasActiveTrades ? await ports.hasActiveTrades(db, userId) : null;
  return {
    status: row.status,
    since: noticeKey ? row.changedAt.toISOString() : null,
    abilities: STATUS_ABILITIES[row.status],
    openTrades,
    supportReference: row.publicId,
    canClose: transitionAllowed(row.status, 'CLOSED', 'SELF') && openTrades === false,
    noticeKey,
  };
}
