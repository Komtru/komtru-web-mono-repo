// How long a session lives, by scope.
//
// Owner ruling 2026-11-22: a consumer or logistics sign-in lasts until midnight in Lagos on the day it
// was made. The access token lives an hour (`IDENTITY_ACCESS_TOKEN_TTL_SECONDS`) and is refreshed with
// the refresh token until then; at midnight the refresh token expires and the person signs in again.
//
// Two deadlines, not one. `idle_expires_at` slides forward on every refresh, so an active user is
// never logged out mid-task; `absolute_expires_at` never moves, so a session cannot be kept alive
// forever by a thief who holds the refresh token and nothing else.
import type { SessionScope } from '@komtru/shared-types';

export interface SessionTtl {
  idleSeconds: number;
  absoluteSeconds: number;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Staff is M1 C3 exactly: 30-minute idle, 8-hour absolute. Consumer keeps the 30-day sliding idle
 * window, but its absolute deadline is no longer a fixed length: it is the next Lagos midnight
 * (`nextLagosMidnight`), which always comes first. `absoluteSeconds` stays as the ceiling that rule
 * can never exceed. LOGISTICS deliberately shares the consumer numbers (ticket T-031).
 */
export const SESSION_TTLS: Record<SessionScope, SessionTtl> = {
  CONSUMER: { idleSeconds: 30 * DAY, absoluteSeconds: 365 * DAY },
  LOGISTICS: { idleSeconds: 30 * DAY, absoluteSeconds: 365 * DAY },
  STAFF: { idleSeconds: 30 * MINUTE, absoluteSeconds: 8 * HOUR },
};

const plus = (now: Date, seconds: number): Date => new Date(now.getTime() + seconds * 1000);

/** Lagos is UTC+1 all year: Nigeria keeps no daylight saving time. */
const LAGOS_OFFSET_MS = HOUR * 1000;

/**
 * The first midnight in Africa/Lagos after `now`: the end of the Lagos calendar day `now` falls in. A
 * sign-in at 23:59:59 Lagos time still ends at that day's midnight, as the owner asked; one at exactly
 * midnight lasts the whole of the new day.
 */
export function nextLagosMidnight(now: Date): Date {
  const lagos = new Date(now.getTime() + LAGOS_OFFSET_MS);
  const nextDayUtc = Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate() + 1);
  return new Date(nextDayUtc - LAGOS_OFFSET_MS);
}

/** The scopes whose sign-in ends at the next Lagos midnight. Staff keeps its own 8-hour cap. */
const ENDS_AT_LAGOS_MIDNIGHT: ReadonlySet<SessionScope> = new Set(['CONSUMER', 'LOGISTICS']);

/** Both deadlines of a brand-new session, from one `now` so they cannot drift apart. */
export function sessionExpiry(
  scope: SessionScope,
  now: Date = new Date(),
): { idleExpiresAt: Date; absoluteExpiresAt: Date } {
  const ttl = SESSION_TTLS[scope];
  const ceiling = plus(now, ttl.absoluteSeconds);
  const absoluteExpiresAt = ENDS_AT_LAGOS_MIDNIGHT.has(scope)
    ? new Date(Math.min(nextLagosMidnight(now).getTime(), ceiling.getTime()))
    : ceiling;
  return { idleExpiresAt: plus(now, ttl.idleSeconds), absoluteExpiresAt };
}

/** The new idle deadline a rotation sets. The absolute one is copied from the parent, never reset. */
export const slidingIdleExpiry = (scope: SessionScope, now: Date = new Date()): Date =>
  plus(now, SESSION_TTLS[scope].idleSeconds);
