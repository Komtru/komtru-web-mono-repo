// How long a session lives, by scope.
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
 * Staff is M1 C3 exactly: 30-minute idle, 8-hour absolute. The ticket pins the consumer idle window
 * at "30 days sliding" and says nothing about an absolute cap, but the column is NOT NULL — 365 days
 * is this build's answer and it is one line to change when the owner names a different one.
 * LOGISTICS deliberately shares the consumer numbers (ticket T-031).
 */
export const SESSION_TTLS: Record<SessionScope, SessionTtl> = {
  CONSUMER: { idleSeconds: 30 * DAY, absoluteSeconds: 365 * DAY },
  LOGISTICS: { idleSeconds: 30 * DAY, absoluteSeconds: 365 * DAY },
  STAFF: { idleSeconds: 30 * MINUTE, absoluteSeconds: 8 * HOUR },
};

const plus = (now: Date, seconds: number): Date => new Date(now.getTime() + seconds * 1000);

/** Both deadlines of a brand-new session, from one `now` so they cannot drift apart. */
export function sessionExpiry(
  scope: SessionScope,
  now: Date = new Date(),
): { idleExpiresAt: Date; absoluteExpiresAt: Date } {
  const ttl = SESSION_TTLS[scope];
  return {
    idleExpiresAt: plus(now, ttl.idleSeconds),
    absoluteExpiresAt: plus(now, ttl.absoluteSeconds),
  };
}

/** The new idle deadline a rotation sets. The absolute one is copied from the parent, never reset. */
export const slidingIdleExpiry = (scope: SessionScope, now: Date = new Date()): Date =>
  plus(now, SESSION_TTLS[scope].idleSeconds);
