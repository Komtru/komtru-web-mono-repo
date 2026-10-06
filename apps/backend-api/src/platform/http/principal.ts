// Who is calling. The platform defines the shape and enforces it (mount.ts); the identity module
// fills it in (T-031), which is why this file knows nothing about tokens, sessions or Postgres.
//
// The one rule that shapes everything here: nothing in a Principal is read off the access token.
// Scope, status, roles, permissions and membership are re-resolved from the database on every single
// request (design §7.3), so a role revoked ten seconds ago stops authorising on the caller's next
// request rather than on their next login.
import type { SessionScope } from '@komtru/shared-types';
import { ApiError } from '../errors.js';

/** Why a credential did not produce a principal. mount.ts maps these onto the 401 problem codes. */
export type AuthFailure =
  /** No Authorization header, or not a Bearer one. */
  | 'TOKEN_MISSING'
  /** Bad signature, wrong issuer or audience, wrong algorithm, or claims that do not parse. */
  | 'TOKEN_INVALID'
  /** Only `exp` failed: the session may well be alive and a refresh will mint a new token. */
  | 'TOKEN_EXPIRED'
  | 'SESSION_REVOKED'
  /** The session passed its idle or absolute deadline. */
  | 'SESSION_EXPIRED'
  /** `users.sessions_epoch` has moved past the token's `epc` — the M1 D5 kill switch. */
  | 'EPOCH_STALE'
  /** The user is SUSPENDED, LOCKED, CLOSED or ANONYMISED. */
  | 'USER_INACTIVE';

/** A LOGISTICS caller's company and role (m2 §2). Resolved per request by T-086; null until then. */
export interface CompanyMembership {
  companyId: string;
  role: string;
}

export interface Principal {
  userId: string;
  publicId: string;
  sessionId: string;
  familyId: string;
  scope: SessionScope;
  /** `users.status`; already checked to be one a session may be used under. */
  status: string;
  sessionsEpoch: number;
  /** How the holder authenticated: ['pwd','otp'], ['passkey']. */
  amr: readonly string[];
  /** Live staff role grants only: not revoked, not expired, and approved if the role needs it. */
  roles: readonly string[];
  permissions: ReadonlySet<string>;
  companyMembership: CompanyMembership | null;
}

export interface Actor {
  /**
   * `user:<uuid>` or `anon`. This is the `actor` column of `platform.idempotency_keys` and the
   * rate limiter's per-user subject, so it has to stay one short stable string per caller.
   */
  key: string;
  principal: Principal | null;
  /** Set only when a credential was presented and rejected; absent for a caller who sent none. */
  failure?: AuthFailure;
}

export const ANONYMOUS_ACTOR_KEY = 'anon';

export const ANONYMOUS_ACTOR: Actor = { key: ANONYMOUS_ACTOR_KEY, principal: null };

export const actorFor = (principal: Principal): Actor => ({
  key: `user:${principal.userId}`,
  principal,
});

/** Anonymous with a reason, for a resolver that rejected the credential it was given. */
export const rejectedActor = (failure: AuthFailure): Actor => ({ ...ANONYMOUS_ACTOR, failure });

/**
 * The calling user's id, or 401. The one way a handler should ask: the id comes off the resolved
 * principal, which T-031 re-reads from the database on every request, rather than off `key` — a
 * string built for the idempotency and rate-limit tables, whose `user:` prefix is a storage detail
 * and not an authentication check. Both modules that need it pass their own `detail`, because
 * "sign in to manage your handle" and "sign in to see your notifications" are what the caller reads.
 */
export const requireUserId = (actor: Actor, detail: string): string => {
  const userId = actor.principal?.userId;
  if (!userId) throw new ApiError(401, 'UNAUTHENTICATED', detail);
  return userId;
};
