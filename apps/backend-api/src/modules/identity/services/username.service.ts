// M1 §6: claiming, changing, quarantining and tombstoning a handle.
//
// Uniqueness is never decided here. `users.username` and `users.username_skeleton` are UNIQUE, so
// the write is attempted and the constraint violation is translated — a check-then-insert would let
// two requests past the same gap (design §4.4). The pre-checks exist to produce a useful message
// and suggestions, not to decide the outcome.
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { usernameChangedEvent, usernameClaimedEvent } from '../domain/events.js';
import {
  CHANGE_COOLDOWN_DAYS,
  LIFETIME_CHANGE_CAP,
  OWNER_RECLAIM_DAYS,
  QUARANTINE_DAYS,
  SUPPORT_APPROVAL_LEVELS,
  validateUsernameFormat,
  type UsernameFormatProblem,
} from '../domain/username/policy.js';
import { matchBlockedSubstring } from '../domain/username/reserved.js';
import { CURRENT_SKELETON_VERSION, skeleton, skeletonVariants } from '../domain/username/skeleton.js';
import { suggestionCandidates } from '../domain/username/suggest.js';
import { reservedUsernames, usernameHistory, users } from '../infrastructure/postgres/schema/index.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SUGGESTION_COUNT = 3;
/** Enough to survive the uniqueness filter at three survivors; the rest are discarded. */
const SUGGESTION_POOL = 24;

export interface UsernameServiceDeps {
  db: Db;
  now?: () => Date;
  /**
   * M1 §6.4 blocks a change while any trade involving the user is not terminal. Trades are M3, so
   * until T-061 supplies this the honest default is "no trades exist". Nothing silently weakens:
   * the check is here and wired, it simply has nothing to ask yet.
   */
  hasActiveTrade?: (userId: string) => Promise<boolean>;
  /** M1 §6.4's "sellers with completed trades"; also T-061's to supply. */
  hasCompletedTrades?: (userId: string) => Promise<boolean>;
}

export type UnavailableReason =
  'INVALID' | 'RESERVED' | 'BLOCKED_TERM' | 'TAKEN' | 'CONFUSABLE' | 'QUARANTINED';

export interface AvailabilityResult {
  /** The normalised handle, so a caller echoing it back shows what would actually be stored. */
  username: string;
  available: boolean;
  reason?: UnavailableReason;
  /** Which format rule fired, when `reason` is `INVALID`. */
  problem?: UsernameFormatProblem;
  suggestions: string[];
}

export interface UsernameHistoryEntry {
  username: string;
  claimedAt: Date;
  releasedAt: Date | null;
  quarantineUntil: Date | null;
  reason: string | null;
}

const addDays = (from: Date, days: number): Date => new Date(from.getTime() + days * DAY_MS);

const conflict = (detail: string): ApiError => new ApiError(409, 'CONFLICT', 'Username unavailable', detail);

const REASON_DETAIL: Record<Exclude<UnavailableReason, 'INVALID'>, string> = {
  RESERVED: 'That handle is reserved.',
  BLOCKED_TERM: 'That handle contains a term we cannot allow.',
  TAKEN: 'That handle is already in use.',
  CONFUSABLE: 'That handle is too close to one already in use.',
  QUARANTINED: 'That handle was recently released and is not yet available.',
};

/** Postgres tells us which rule fired; the caller deserves to know which one too. */
const translateWriteError = (error: unknown): ApiError | undefined => {
  const { code, constraint } = (error ?? {}) as { code?: string; constraint?: string };
  if (code === '23505') {
    if (constraint?.includes('skeleton')) return conflict(REASON_DETAIL.CONFUSABLE);
    return conflict(REASON_DETAIL.TAKEN);
  }
  // users_username_format casts to ::text, so it fires before the unique index and a mixed-case or
  // malformed handle arrives as 23514. Reaching this means validateUsernameFormat drifted looser
  // than the database CHECK; answering "taken" would be a lie about someone else's handle.
  if (code === '23514') {
    return new ApiError(422, 'VALIDATION_FAILED', 'Invalid username', 'That handle is not a valid handle.');
  }
  return undefined;
};

const rethrow = (error: unknown): never => {
  throw translateWriteError(error) ?? error;
};

interface QuarantineRow {
  userId: string;
  releasedAt: Date | null;
  quarantineUntil: Date | null;
}

/**
 * The one rule that spans two tables and so cannot be an index: a released handle is unclaimable by
 * anyone for 90 days and reclaimable by its original owner for the first 30 (M1 §6.4).
 */
const quarantineBlocks = (rows: QuarantineRow[], now: Date, forUserId?: string): boolean =>
  rows.some((row) => {
    if (!row.quarantineUntil || row.quarantineUntil <= now) return false;
    const reclaimable =
      forUserId !== undefined &&
      row.userId === forUserId &&
      row.releasedAt !== null &&
      now < addDays(row.releasedAt, OWNER_RECLAIM_DAYS);
    return !reclaimable;
  });

const quarantineRows = async (db: Db | Tx, variants: string[]): Promise<QuarantineRow[]> =>
  db
    .select({
      userId: usernameHistory.userId,
      releasedAt: usernameHistory.releasedAt,
      quarantineUntil: usernameHistory.quarantineUntil,
    })
    .from(usernameHistory)
    .where(
      and(inArray(usernameHistory.usernameSkeleton, variants), isNotNull(usernameHistory.quarantineUntil)),
    );

interface Verdict {
  username: string;
  skeleton: string;
  reason?: UnavailableReason;
  problem?: UsernameFormatProblem;
}

/**
 * Everything that can be decided before the write, in the order that produces the most useful
 * message: a malformed handle is a typo, a reserved one is a policy answer, and only then is it
 * worth telling someone their choice is taken.
 */
const assess = async (db: Db | Tx, raw: string, now: Date, forUserId?: string): Promise<Verdict> => {
  const format = validateUsernameFormat(raw);
  if (!format.ok)
    return { username: raw.trim().toLowerCase(), skeleton: '', reason: 'INVALID', problem: format.problem };

  const username = format.username;
  const variants = skeletonVariants(username);
  const canonical = variants[0] ?? skeleton(username);

  const blocked = matchBlockedSubstring(username);
  if (blocked) return { username, skeleton: canonical, reason: 'BLOCKED_TERM' };

  const reserved = await db
    .select({ usernameSkeleton: reservedUsernames.usernameSkeleton })
    .from(reservedUsernames)
    .where(inArray(reservedUsernames.usernameSkeleton, variants))
    .limit(1);
  if (reserved.length > 0) return { username, skeleton: canonical, reason: 'RESERVED' };

  if (quarantineBlocks(await quarantineRows(db, variants), now, forUserId))
    return { username, skeleton: canonical, reason: 'QUARANTINED' };

  const existing = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.usernameSkeleton, canonical))
    .limit(1);
  const holder = existing[0];
  if (holder)
    return {
      username,
      skeleton: canonical,
      reason: holder.username === username ? 'TAKEN' : 'CONFUSABLE',
    };

  return { username, skeleton: canonical };
};

export async function checkUsernameAvailability(
  deps: UsernameServiceDeps,
  raw: string,
  options: { forUserId?: string; suggestions?: number } = {},
): Promise<AvailabilityResult> {
  const now = deps.now?.() ?? new Date();
  const verdict = await assess(deps.db, raw, now, options.forUserId);

  if (!verdict.reason) return { username: verdict.username, available: true, suggestions: [] };

  const wanted = options.suggestions ?? SUGGESTION_COUNT;
  const suggestions: string[] = [];
  // §6.5: each suggestion is pre-checked against the live namespace, which is also what stops us
  // handing an attacker something confusable with an existing account.
  for (const candidate of suggestionCandidates(verdict.username, SUGGESTION_POOL)) {
    if (suggestions.length >= wanted) break;
    const check = await assess(deps.db, candidate, now, options.forUserId);
    if (!check.reason) suggestions.push(check.username);
  }

  return {
    username: verdict.username,
    available: false,
    reason: verdict.reason,
    ...(verdict.problem ? { problem: verdict.problem } : {}),
    suggestions,
  };
}

const refuse = (verdict: Verdict): never => {
  if (verdict.reason === 'INVALID')
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'Invalid username',
      `That handle is not valid (${verdict.problem}).`,
    );
  throw conflict(REASON_DETAIL[verdict.reason as Exclude<UnavailableReason, 'INVALID'>]);
};

interface CurrentUser {
  id: string;
  username: string | null;
  usernameSetAt: Date | null;
  usernameChangeCount: number;
  verificationLevel: string;
}

const loadUser = async (tx: Tx, userId: string): Promise<CurrentUser> => {
  const rows = await tx
    .select({
      id: users.id,
      username: users.username,
      usernameSetAt: users.usernameSetAt,
      usernameChangeCount: users.usernameChangeCount,
      verificationLevel: users.verificationLevel,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = rows[0];
  if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
  return user;
};

/** Writes the users row and its history, and translates the constraint that decides the race. */
const writeHandle = async (
  tx: Tx,
  input: { userId: string; username: string; skeleton: string; now: Date; incrementCount: boolean },
): Promise<void> => {
  try {
    await tx
      .update(users)
      .set({
        username: input.username,
        usernameSkeleton: input.skeleton,
        skeletonVersion: CURRENT_SKELETON_VERSION,
        usernameSetAt: input.now,
        ...(input.incrementCount ? { usernameChangeCount: sql`${users.usernameChangeCount} + 1` } : {}),
      })
      .where(eq(users.id, input.userId));
  } catch (error) {
    rethrow(error);
  }
  await tx.insert(usernameHistory).values({
    userId: input.userId,
    username: input.username,
    usernameSkeleton: input.skeleton,
    skeletonVersion: CURRENT_SKELETON_VERSION,
    claimedAt: input.now,
  });
};

export async function claimUsername(
  deps: UsernameServiceDeps,
  input: { userId: string; username: string },
): Promise<{ username: string }> {
  const now = deps.now?.() ?? new Date();

  return deps.db.transaction(async (tx) => {
    const user = await loadUser(tx, input.userId);
    if (user.username)
      throw conflict('This account already has a handle; change it instead of claiming another.');

    const verdict = await assess(tx, input.username, now, input.userId);
    if (verdict.reason) refuse(verdict);

    // First claim, not a change: `username_change_count` counts changes, and incrementing it here
    // would spend one of the three against the user before they had ever renamed.
    await writeHandle(tx, {
      userId: input.userId,
      username: verdict.username,
      skeleton: verdict.skeleton,
      now,
      incrementCount: false,
    });
    await publish(tx, usernameClaimedEvent, {
      payload: { userId: input.userId, username: verdict.username },
      aggregateType: 'identity.user',
      aggregateId: input.userId,
      actor: { type: 'CONSUMER', id: input.userId },
    });

    return { username: verdict.username };
  });
}

export async function changeUsername(
  deps: UsernameServiceDeps,
  input: {
    userId: string;
    username: string;
    reason: string;
    /** The staff member, on a forced change. */
    actorUserId?: string;
    forced?: boolean;
  },
): Promise<{ username: string; previous: string }> {
  const now = deps.now?.() ?? new Date();
  const forced = input.forced ?? false;

  // Outside the transaction: these ask other modules, and a cross-module call inside a transaction
  // holds row locks for the length of someone else's query.
  if (!forced) {
    if (await (deps.hasActiveTrade?.(input.userId) ?? Promise.resolve(false)))
      throw conflict('You cannot change your handle while a trade is still in progress.');
  }

  return deps.db.transaction(async (tx) => {
    const user = await loadUser(tx, input.userId);
    const previous = user.username;
    if (!previous) throw conflict('This account has no handle yet; claim one instead.');

    if (!forced) {
      if (user.usernameChangeCount >= LIFETIME_CHANGE_CAP)
        throw conflict(
          `You have used all ${LIFETIME_CHANGE_CAP} handle changes; contact support to change it again.`,
        );
      if (user.usernameSetAt && now < addDays(user.usernameSetAt, CHANGE_COOLDOWN_DAYS))
        throw conflict(`A handle can be changed once every ${CHANGE_COOLDOWN_DAYS} days.`);
      if (
        (SUPPORT_APPROVAL_LEVELS as readonly string[]).includes(user.verificationLevel) &&
        (await (deps.hasCompletedTrades?.(input.userId) ?? Promise.resolve(false)))
      )
        throw conflict('A verified seller with completed trades needs support approval to change handle.');
    }

    const verdict = await assess(tx, input.username, now, input.userId);
    if (verdict.reason) refuse(verdict);

    // The handle being released. Quarantine is recorded on the row that held it, so a reclaim can
    // tell "mine, 20 days ago" from "someone else's, 20 days ago".
    await tx
      .update(usernameHistory)
      .set({
        releasedAt: now,
        quarantineUntil: addDays(now, QUARANTINE_DAYS),
        reason: input.reason,
        ...(input.actorUserId ? { changedBy: input.actorUserId } : {}),
      })
      .where(and(eq(usernameHistory.userId, input.userId), eq(usernameHistory.username, previous)));

    await writeHandle(tx, {
      userId: input.userId,
      username: verdict.username,
      skeleton: verdict.skeleton,
      now,
      incrementCount: !forced,
    });

    await publish(tx, usernameChangedEvent, {
      payload: {
        userId: input.userId,
        from: previous,
        to: verdict.username,
        reason: input.reason,
        forced,
      },
      aggregateType: 'identity.user',
      aggregateId: input.userId,
      // A forced change is a staff action on someone else's row; say so in the audit trail.
      actor: input.actorUserId
        ? { type: 'STAFF', id: input.actorUserId }
        : { type: 'CONSUMER', id: input.userId },
    });

    return { username: verdict.username, previous };
  });
}

export async function listUsernameHistory(
  deps: UsernameServiceDeps,
  userId: string,
): Promise<UsernameHistoryEntry[]> {
  return deps.db
    .select({
      username: usernameHistory.username,
      claimedAt: usernameHistory.claimedAt,
      releasedAt: usernameHistory.releasedAt,
      quarantineUntil: usernameHistory.quarantineUntil,
      reason: usernameHistory.reason,
    })
    .from(usernameHistory)
    .where(eq(usernameHistory.userId, userId))
    .orderBy(desc(usernameHistory.claimedAt));
}

/** Lowercase base32 without the letters that read as digits — the handle is shown to humans. */
const TOMBSTONE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const TOMBSTONE_ATTEMPTS = 5;

const tombstoneHandle = (): string => {
  let suffix = '';
  for (const byte of globalThis.crypto.getRandomValues(new Uint8Array(8)))
    suffix += TOMBSTONE_ALPHABET[byte % TOMBSTONE_ALPHABET.length];
  return `deleted_${suffix}`;
};

/**
 * M1 §15. Replaces the handle with a tombstone and quarantines the old one like any other release,
 * so an anonymised seller's handle cannot be picked up by the next person through the door.
 *
 * Retried rather than pre-checked: `deleted_` handles collide only by chance, and the unique index
 * is the thing that knows.
 */
export async function tombstoneUsername(
  deps: UsernameServiceDeps,
  input: { userId: string; actorUserId?: string },
): Promise<{ username: string }> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const { username } = await changeUsername(deps, {
        userId: input.userId,
        username: tombstoneHandle(),
        reason: 'anonymisation',
        ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
        forced: true,
      });
      return { username };
    } catch (error) {
      const retryable = error instanceof ApiError && error.status === 409;
      if (!retryable || attempt >= TOMBSTONE_ATTEMPTS) throw error;
    }
  }
}
