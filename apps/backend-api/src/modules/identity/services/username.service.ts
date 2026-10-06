// M1 §6: claiming, changing, quarantining and tombstoning a handle.
//
// Uniqueness is never decided here. `users.username` and `users.username_skeleton` are UNIQUE, so
// the write is attempted and the constraint violation is translated — a check-then-insert would let
// two requests past the same gap (design §4.4). The pre-checks exist to produce a useful message
// and suggestions, not to decide the outcome.
import type { Paged } from '@komtru/shared-types';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { pgErrorIn } from '../../../db/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { usernameChangedEvent, usernameClaimedEvent } from '../domain/events.js';
import {
  CHANGE_COOLDOWN_DAYS,
  LIFETIME_CHANGE_CAP,
  OWNER_RECLAIM_DAYS,
  QUARANTINE_DAYS,
  SUPPORT_APPROVAL_LEVELS,
  normaliseUsername,
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

/**
 * Postgres tells us which rule fired; the caller deserves to know which one too.
 *
 * Exported for its own test: this runs only when both callers passed the availability pre-check and
 * the index decided, which is the one interleaving an integration test cannot force on demand.
 */
export const translateWriteError = (error: unknown): ApiError | undefined => {
  // Through `pgErrorIn`, because drizzle hands back its own error with the driver's on `cause`;
  // reading `code` off the top level sees undefined and lets a 409 escape as a 500.
  const { code, constraint } = pgErrorIn(error) ?? {};
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
  skeleton?: string;
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

const quarantineRows = async (
  db: Db | Tx,
  variants: string[],
  withSkeleton = false,
): Promise<QuarantineRow[]> =>
  db
    .select({
      userId: usernameHistory.userId,
      releasedAt: usernameHistory.releasedAt,
      quarantineUntil: usernameHistory.quarantineUntil,
      ...(withSkeleton ? { skeleton: usernameHistory.usernameSkeleton } : {}),
    })
    .from(usernameHistory)
    .where(
      and(inArray(usernameHistory.usernameSkeleton, variants), isNotNull(usernameHistory.quarantineUntil)),
    );

/**
 * Who, if anyone, already folds onto this skeleton.
 *
 * **Known gap, deliberately not papered over.** This compares the CANONICAL fold only, while the
 * reserved-word check above compares every fold. So `@delistore` is claimable beside `@dellstore`
 * and `@iagosdeals` beside `@lagosdeals` — the narrow fold agrees on both pairs, the canonical fold
 * does not, and in a sans-serif font they are the same handle. Storefront impersonation is thus
 * less well defended than `@admin` impersonation, which is backwards: a buyer is far likelier to be
 * defrauded by a cloned seller handle.
 *
 * It is not fixed here because the only honest fix is a `users.username_skeleton_narrow` column
 * with its own UNIQUE index — a migration this ticket is forbidden to write, another agent owning
 * the next number. A service-side narrow pre-check without that index would be a full table scan on
 * a PUBLIC endpoint and still a check-then-insert race, which is worse than the gap it closes.
 * Carrying the gap visibly beats hiding it behind a scan that does not actually hold.
 */
const holder = async (
  db: Db | Tx,
  username: string,
  canonical: string,
): Promise<{ reason?: UnavailableReason }> => {
  const rows = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.usernameSkeleton, canonical))
    .limit(1);
  const existing = rows[0];
  if (!existing) return {};
  return { reason: existing.username === username ? 'TAKEN' : 'CONFUSABLE' };
};

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
    // normaliseUsername, not a bare lowercase: every other path echoes the handle the way it would
    // be stored, and `@Jane` coming back as `@jane` with the sigil still on is a different answer.
    return { username: normaliseUsername(raw), skeleton: '', reason: 'INVALID', problem: format.problem };

  const username = format.username;
  const variants = skeletonVariants(username);
  const canonical = variants[0] ?? skeleton(username);

  // The table is consulted before the hardcoded substring list, because `releasable` is the escape
  // hatch §6.2 promises: a user genuinely called Komtru gets a `releasable = true` row from Trust &
  // Safety, and that row has to beat both the exact reservation and the substring block. A
  // `releasable = false` row is an ordinary reservation.
  const reserved = await db
    .select({
      usernameSkeleton: reservedUsernames.usernameSkeleton,
      releasable: reservedUsernames.releasable,
    })
    .from(reservedUsernames)
    .where(inArray(reservedUsernames.usernameSkeleton, variants));
  if (reserved.some((row) => row.usernameSkeleton === canonical && row.releasable))
    return { username, skeleton: canonical, ...(await holder(db, username, canonical)) };
  if (reserved.some((row) => !row.releasable)) return { username, skeleton: canonical, reason: 'RESERVED' };

  if (matchBlockedSubstring(username)) return { username, skeleton: canonical, reason: 'BLOCKED_TERM' };

  if (quarantineBlocks(await quarantineRows(db, variants), now, forUserId))
    return { username, skeleton: canonical, reason: 'QUARANTINED' };

  return { username, skeleton: canonical, ...(await holder(db, username, canonical)) };
};

/**
 * Which of `candidates` are free, up to `wanted`, in three queries over the whole set.
 *
 * Order is preserved, so the caller still gets the suggestion engine's preference order rather than
 * whatever the database returned.
 */
const screen = async (
  db: Db,
  candidates: string[],
  now: Date,
  wanted: number,
  forUserId?: string,
): Promise<string[]> => {
  if (candidates.length === 0 || wanted <= 0) return [];

  const variantsOf = new Map(candidates.map((candidate) => [candidate, skeletonVariants(candidate)]));
  const allVariants = [...new Set([...variantsOf.values()].flat())];

  const [reserved, quarantined, taken] = await Promise.all([
    db
      .select({
        usernameSkeleton: reservedUsernames.usernameSkeleton,
        releasable: reservedUsernames.releasable,
      })
      .from(reservedUsernames)
      .where(inArray(reservedUsernames.usernameSkeleton, allVariants)),
    quarantineRows(db, allVariants, true),
    db
      .select({ usernameSkeleton: users.usernameSkeleton })
      .from(users)
      .where(inArray(users.usernameSkeleton, allVariants)),
  ]);

  const blockedSkeletons = new Set(reserved.filter((row) => !row.releasable).map((r) => r.usernameSkeleton));
  const takenSkeletons = new Set(taken.map((row) => row.usernameSkeleton));
  const free: string[] = [];

  for (const candidate of candidates) {
    if (free.length >= wanted) break;
    const variants = variantsOf.get(candidate) ?? [];
    const canonical = variants[0] ?? '';
    if (variants.some((v) => blockedSkeletons.has(v))) continue;
    if (matchBlockedSubstring(candidate)) continue;
    if (takenSkeletons.has(canonical)) continue;
    const relevant = quarantined.filter(
      (row) => row.skeleton !== undefined && variants.includes(row.skeleton),
    );
    if (quarantineBlocks(relevant, now, forUserId)) continue;
    free.push(candidate);
  }

  return free;
};

export async function checkUsernameAvailability(
  deps: UsernameServiceDeps,
  raw: string,
  options: { forUserId?: string; suggestions?: number } = {},
): Promise<AvailabilityResult> {
  const now = deps.now?.() ?? new Date();
  const verdict = await assess(deps.db, raw, now, options.forUserId);

  if (!verdict.reason) return { username: verdict.username, available: true, suggestions: [] };

  // §6.5: each suggestion is pre-checked against the live namespace, which is also what stops us
  // handing an attacker something confusable with an existing account. Screened in one batch of
  // three queries rather than three per candidate: this is a PUBLIC endpoint, and a pool of 24 run
  // one at a time is 72 round trips for one availability check.
  const suggestions = await screen(
    deps.db,
    suggestionCandidates(verdict.username, SUGGESTION_POOL),
    now,
    options.suggestions ?? SUGGESTION_COUNT,
    options.forUserId,
  );

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
    .limit(1)
    // The cooldown, the lifetime cap and the support-approval gate are read-then-write rules that
    // no index can enforce. Without this, two concurrent PATCHes both read change_count = 2 and the
    // user gets a fourth change. Row-level, on the caller's own row: no cross-request contention.
    .for('update');
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
    /** Reserve the released handle for good rather than quarantining it (M1 §15). */
    retireHandle?: boolean;
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
      // `isNull(releasedAt)`: a handle the owner reclaimed has two rows, and overwriting the older
      // one's release would rewrite the quarantine history of a handle someone else may have held.
      .where(
        and(
          eq(usernameHistory.userId, input.userId),
          eq(usernameHistory.username, previous),
          isNull(usernameHistory.releasedAt),
        ),
      );

    // M1 §15 step 1. Quarantine alone is not enough for anonymisation: §15 step 3 deletes the
    // user's `username_history` rows, which is where the quarantine lives, so without this the
    // handle of an erased (often fraud-closed) seller is free the moment the procedure finishes.
    if (input.retireHandle) {
      await tx
        .insert(reservedUsernames)
        .values(
          skeletonVariants(previous).map((fold) => ({
            usernameSkeleton: fold,
            category: 'SYSTEM',
            note: 'retired by anonymisation',
          })),
        )
        .onConflictDoNothing();
    }

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

/**
 * Newest first, one page at a time. A handle-churning account is rare but the route declares page
 * pagination, and the platform's mount layer refuses a response longer than the caller's `limit` —
 * so an unpaged query here is a 500 on a perfectly valid `?limit=1`.
 */
export async function listUsernameHistory(
  deps: UsernameServiceDeps,
  userId: string,
  { page = 1, limit = 20 }: { page?: number; limit?: number } = {},
): Promise<Paged<UsernameHistoryEntry>> {
  const [items, totals] = await Promise.all([
    deps.db
      .select({
        username: usernameHistory.username,
        claimedAt: usernameHistory.claimedAt,
        releasedAt: usernameHistory.releasedAt,
        quarantineUntil: usernameHistory.quarantineUntil,
        reason: usernameHistory.reason,
      })
      .from(usernameHistory)
      .where(eq(usernameHistory.userId, userId))
      .orderBy(desc(usernameHistory.claimedAt))
      .limit(limit)
      .offset((page - 1) * limit),
    deps.db
      .select({ total: sql<number>`count(*)::int` })
      .from(usernameHistory)
      .where(eq(usernameHistory.userId, userId)),
  ]);

  return { items, page, limit, total: totals[0]?.total ?? 0 };
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
): Promise<{ username: string | null }> {
  // Most accounts that reach erasure never claimed a handle — a social sign-up that stalled, a
  // registration abandoned at the OTP. There is nothing to tombstone, and erasure must not fail.
  const rows = await deps.db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'User not found');
  if (!rows[0].username) return { username: null };

  for (let attempt = 1; ; attempt += 1) {
    try {
      const { username } = await changeUsername(deps, {
        userId: input.userId,
        username: tombstoneHandle(),
        reason: 'anonymisation',
        ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
        forced: true,
        retireHandle: true,
      });
      return { username };
    } catch (error) {
      // Only a collision is transient. Every other 409 — no handle, a rule we cannot satisfy — would
      // just be raised five times and then surfaced to a compliance job as the same failure.
      const collision =
        error instanceof ApiError &&
        (error.detail === REASON_DETAIL.TAKEN || error.detail === REASON_DETAIL.CONFUSABLE);
      if (!collision || attempt >= TOMBSTONE_ATTEMPTS) throw error;
    }
  }
}
