// Sessions: minting them, rotating them, detecting a replay, and killing them all at once.
//
// M1 D5 in one paragraph. The refresh token is opaque and single-use; using it consumes the row it
// names and inserts a child in the same rotation family. Presenting a token whose row is already
// consumed is, by definition, a replay — either the client's or a thief's, and there is no way to
// tell which — so the whole family dies and Risk hears about it. The access token is stateless and
// short, and `users.sessions_epoch` is what kills every outstanding one at a stroke.
import {
  identitySessionCreatedEvent,
  identitySessionReuseDetectedEvent,
  type SessionScope,
} from '@komtru/shared-types';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import type { Logger } from '../../../platform/logger.js';
import { issueRefreshToken, refreshTokenHash } from '../domain/session/refresh-token.js';
import { sessionExpiry, slidingIdleExpiry } from '../domain/session/ttl.js';
import type { TokenSigner } from '../infrastructure/jwt/access-token.js';
import { sessions } from '../infrastructure/postgres/schema/sessions.js';
import { users } from '../infrastructure/postgres/schema/users.js';
import type { EpochCache } from '../infrastructure/redis/epoch-cache.js';

/** M1 D5: `/auth/refresh` re-reads the status and refuses anything outside these three. */
const USABLE_STATUSES = ['ACTIVE', 'PENDING_VERIFICATION', 'RESTRICTED'];

export interface SessionDeps {
  signer: TokenSigner;
  epochs: EpochCache;
  logger: Logger;
}

export interface IssuedSession {
  sessionId: string;
  familyId: string;
  scope: SessionScope;
  accessToken: string;
  /** Returned to the client once; only its SHA-256 is stored. */
  refreshToken: string;
  /** Seconds until the access token expires, for the `expiresIn` the API contract returns. */
  expiresIn: number;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface CreateSessionInput {
  userId: string;
  scope: SessionScope;
  amr: readonly string[];
  deviceId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  isNewDevice?: boolean;
}

type SessionRow = typeof sessions.$inferSelect;

const userFor = async (
  tx: Tx,
  userId: string,
): Promise<{ status: string; sessionsEpoch: number } | undefined> =>
  (
    await tx
      .select({ status: users.status, sessionsEpoch: users.sessionsEpoch })
      .from(users)
      .where(eq(users.id, userId))
  )[0];

/**
 * Opens a session. Takes the caller's transaction rather than the pool: a login writes an audit row,
 * a device row and this, and either all of them happen or none do — including the event, which goes
 * to the outbox in the same transaction (design §4.3).
 */
export async function createSession(
  tx: Tx,
  deps: SessionDeps,
  input: CreateSessionInput,
): Promise<IssuedSession> {
  const user = await userFor(tx, input.userId);
  if (!user) throw new Error(`createSession: no user ${input.userId}`);
  if (!USABLE_STATUSES.includes(user.status)) {
    throw new Error(`createSession: a user with status ${user.status} may not open a session`);
  }

  const { token, hash } = issueRefreshToken();
  const { idleExpiresAt, absoluteExpiresAt } = sessionExpiry(input.scope);
  const amr = [...input.amr];

  const row = (
    await tx
      .insert(sessions)
      .values({
        userId: input.userId,
        deviceId: input.deviceId ?? null,
        scope: input.scope,
        familyId: sql`gen_random_uuid()`,
        refreshTokenHash: hash,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        amr,
        absoluteExpiresAt,
        idleExpiresAt,
      })
      .returning({ id: sessions.id, familyId: sessions.familyId })
  )[0];
  if (!row) throw new Error('createSession: the insert returned no row');

  await publish(tx, identitySessionCreatedEvent, {
    payload: {
      userId: input.userId,
      sessionId: row.id,
      familyId: row.familyId,
      scope: input.scope,
      deviceId: input.deviceId ?? null,
      ip: input.ip ?? null,
      amr,
      isNewDevice: input.isNewDevice ?? false,
    },
    aggregateType: 'identity.session',
    aggregateId: row.id,
    actor: { type: input.scope, id: input.userId },
  });

  return {
    sessionId: row.id,
    familyId: row.familyId,
    scope: input.scope,
    accessToken: await deps.signer.sign({
      sub: input.userId,
      sid: row.id,
      scp: input.scope,
      epc: user.sessionsEpoch,
    }),
    refreshToken: token,
    expiresIn: deps.signer.ttlSeconds,
    idleExpiresAt,
    absoluteExpiresAt,
  };
}

export type RefreshOutcome =
  | { outcome: 'ROTATED'; session: IssuedSession }
  /** No session has ever held this token: nothing to rotate and nothing to punish. */
  | { outcome: 'UNKNOWN' }
  /** A consumed token was presented again. The family is already dead by the time this returns. */
  | { outcome: 'REUSED'; familyId: string; revoked: number }
  | { outcome: 'EXPIRED' }
  | { outcome: 'REVOKED' }
  | { outcome: 'USER_INACTIVE' };

export interface RefreshInput {
  refreshToken: string;
  ip?: string | null;
  userAgent?: string | null;
}

export async function refreshSession(
  db: Db,
  deps: SessionDeps,
  input: RefreshInput,
): Promise<RefreshOutcome> {
  const hash = refreshTokenHash(input.refreshToken);

  return db.transaction(async (tx) => {
    // `FOR UPDATE` is the whole concurrency story. Two transactions presenting the same token both
    // reach it; the second blocks on the row lock and, under READ COMMITTED, re-reads the row once
    // the first commits — so it sees `consumed_at` set and takes the replay branch. Every check
    // below therefore runs while this row cannot change underneath it.
    const session = (
      await tx.select().from(sessions).where(eq(sessions.refreshTokenHash, hash)).for('update')
    )[0];

    if (!session) return { outcome: 'UNKNOWN' };
    if (session.consumedAt !== null) return detectReuse(tx, deps, session, input);
    // Revoked but never consumed: the session was ended deliberately (logout, suspension, a family
    // kill). The holder is out of date, not replaying, and saying otherwise would drown the signal.
    if (session.revokedAt !== null) return { outcome: 'REVOKED' };

    const now = Date.now();
    if (session.idleExpiresAt.getTime() <= now || session.absoluteExpiresAt.getTime() <= now) {
      return { outcome: 'EXPIRED' };
    }

    // M1 D5's third requirement: the status is re-read here rather than trusted from whatever it was
    // when the token was minted. Without this a suspended user refreshes into a token carrying the
    // new epoch and the kill switch achieves nothing.
    const user = await userFor(tx, session.userId);
    if (!user) throw new Error(`refreshSession: no user ${session.userId}`);
    if (!USABLE_STATUSES.includes(user.status)) return { outcome: 'USER_INACTIVE' };

    await tx
      .update(sessions)
      .set({ consumedAt: sql`now()`, lastUsedAt: sql`now()` })
      .where(eq(sessions.id, session.id));

    const { token, hash: nextHash } = issueRefreshToken();
    const idleExpiresAt = slidingIdleExpiry(session.scope);

    // `user_id`, `scope`, `family_id`, `amr` and `absolute_expires_at` are copied by Postgres from
    // the parent row and are never parameters here. That is what makes it impossible for a request
    // to move a session between users, scopes or families, or to push the absolute deadline out by
    // refreshing — and it is the rotation-family integrity the schema's self-FK cannot enforce.
    const inserted = await tx.execute<{ id: string }>(sql`
      INSERT INTO identity.sessions
        (user_id, device_id, scope, family_id, refresh_token_hash, parent_session_id, ip, user_agent,
         amr, absolute_expires_at, idle_expires_at)
      SELECT user_id, device_id, scope, family_id, ${nextHash}, id, ${input.ip ?? null}::inet,
             ${input.userAgent ?? null}, amr, absolute_expires_at, ${idleExpiresAt}
        FROM identity.sessions
       WHERE id = ${session.id}::uuid
      RETURNING id`);
    const childId = inserted.rows[0]?.id;
    if (childId === undefined) throw new Error('refreshSession: the rotation inserted no row');
    const child = (await tx.select().from(sessions).where(eq(sessions.id, childId)))[0];
    if (!child) throw new Error('refreshSession: the rotated row vanished');

    return {
      outcome: 'ROTATED',
      session: {
        sessionId: child.id,
        familyId: child.familyId,
        scope: child.scope,
        accessToken: await deps.signer.sign({
          sub: child.userId,
          sid: child.id,
          scp: child.scope,
          epc: user.sessionsEpoch,
        }),
        refreshToken: token,
        expiresIn: deps.signer.ttlSeconds,
        idleExpiresAt: child.idleExpiresAt,
        absoluteExpiresAt: child.absoluteExpiresAt,
      },
    };
  });
}

/**
 * A token whose row is already consumed was presented again. There is no way to tell the client's
 * own double-submit from a thief's replay, and M1 D5 answers both the same way: the entire rotation
 * family dies and Risk hears about it.
 */
async function detectReuse(
  tx: Tx,
  deps: SessionDeps,
  session: SessionRow,
  input: RefreshInput,
): Promise<RefreshOutcome> {
  const revoked = await revokeFamily(tx, session.familyId, 'reuse_detected');
  await publish(tx, identitySessionReuseDetectedEvent, {
    payload: {
      userId: session.userId,
      familyId: session.familyId,
      replayedSessionId: session.id,
      scope: session.scope,
      ip: input.ip ?? null,
      revokedSessions: revoked,
    },
    aggregateType: 'identity.session',
    aggregateId: session.id,
    actor: { type: session.scope, id: session.userId },
  });
  deps.logger.warn(
    { userId: session.userId, familyId: session.familyId, revoked },
    'identity: refresh token reuse detected, rotation family revoked',
  );
  return { outcome: 'REUSED', familyId: session.familyId, revoked };
}

const revokeFamily = async (tx: Tx, familyId: string, reason: string): Promise<number> =>
  (
    await tx
      .update(sessions)
      .set({ revokedAt: sql`now()`, revokeReason: reason })
      .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id })
  ).length;

export interface RevokeFamilyInput {
  refreshToken: string;
  /** Every session of the user, not only this family — M1 §10.1's `allDevices`. */
  allDevices?: boolean;
  reason: string;
}

/**
 * Logout. The whole family goes, not just the row the token names: the access token minted by the
 * last rotation would otherwise keep working for up to its ten minutes.
 */
export async function revokeSessionFamily(db: Db, input: RevokeFamilyInput): Promise<number> {
  const hash = refreshTokenHash(input.refreshToken);
  return db.transaction(async (tx) => {
    const session = (
      await tx
        .select({ userId: sessions.userId, familyId: sessions.familyId })
        .from(sessions)
        .where(eq(sessions.refreshTokenHash, hash))
    )[0];
    // Unknown token: nothing to do. The caller answers the same way either way, so a logout is never
    // an oracle for whether a token was real.
    if (!session) return 0;
    return input.allDevices
      ? revokeAllSessions(tx, { userId: session.userId, reason: input.reason })
      : revokeFamily(tx, session.familyId, input.reason);
  });
}

export interface RevokeAllInput {
  userId: string;
  reason: string;
  /** The session doing the revoking — a password change keeps the caller signed in (M1 §9.2). */
  exceptSessionId?: string;
}

/** Inside the caller's transaction: suspension (T-039) and password change (T-032) both need this. */
export async function revokeAllSessions(tx: Tx, input: RevokeAllInput): Promise<number> {
  const where = [eq(sessions.userId, input.userId), isNull(sessions.revokedAt)];
  if (input.exceptSessionId !== undefined) where.push(ne(sessions.id, input.exceptSessionId));
  return (
    await tx
      .update(sessions)
      .set({ revokedAt: sql`now()`, revokeReason: input.reason })
      .where(and(...where))
      .returning({ id: sessions.id })
  ).length;
}

/** Invalidates every outstanding access token for a user at once. Returns the new epoch. */
export async function bumpSessionsEpoch(tx: Tx, userId: string): Promise<number> {
  const row = (
    await tx
      .update(users)
      .set({ sessionsEpoch: sql`${users.sessionsEpoch} + 1`, updatedAt: sql`now()` })
      .where(eq(users.id, userId))
      .returning({ sessionsEpoch: users.sessionsEpoch })
  )[0];
  if (!row) throw new Error(`bumpSessionsEpoch: no user ${userId}`);
  return row.sessionsEpoch;
}

/**
 * M1 D5's kill switch, as one transaction, because doing only part of it is the bug the spec calls
 * out by name: bumping the epoch alone kills the issued access tokens and leaves the refresh token
 * able to mint new ones stamped with the new epoch. T-039's suspend runs the status change in its
 * own transaction alongside `bumpSessionsEpoch` and `revokeAllSessions`; this is the standalone
 * version, and the one the D5 test exercises.
 */
export async function applyKillSwitch(
  db: Db,
  deps: SessionDeps,
  input: { userId: string; reason: string },
): Promise<{ epoch: number; revoked: number }> {
  const result = await db.transaction(async (tx) => ({
    epoch: await bumpSessionsEpoch(tx, input.userId),
    revoked: await revokeAllSessions(tx, { userId: input.userId, reason: input.reason }),
  }));
  // After the commit, and best-effort on purpose. A missed invalidation costs one cache hit and
  // nothing more: `resolvePrincipal` compares the token's epoch against the row it just read, so a
  // stale cache can never admit a token the database would refuse.
  await deps.epochs.invalidate(input.userId);
  return result;
}
