// The ticket's hard part: how a long-lived connection learns that its session died.
//
// Over HTTP, nothing about authorisation is cached — `resolvePrincipal` re-reads scope, status,
// epoch, roles and permissions from Postgres on *every request*, so revoking a session or bumping
// `users.sessions_epoch` stops the caller on their next request. A socket has no next request. It
// can sit open for hours having been authenticated exactly once, which is precisely the shape of
// bug M1 D5's kill switch exists to prevent.
//
// So the gateway manufactures the missing request. Every socket keeps the credential it presented,
// and on a fixed interval this sweep re-runs the *same* `resolvePrincipal` over it. The verdicts
// are literally the HTTP verdicts — one code path, no second authorisation path to drift — and the
// mechanism depends on nothing but this process being alive.
//
// The staleness bound, exactly. A socket holding a *live* credential is re-decided every interval,
// so a revocation reaches it within one interval. A socket whose credential has lapsed is a
// different case, and the honest number is worse: `resolvePrincipal` rejects on `exp` before it
// queries anything, so while a token is expired the gateway can learn nothing about that session —
// not a revocation, not the epoch, not the user's status. That is why the grace window is measured
// from the moment a credential first fails rather than from the last success (which could be an
// instant before `exp`, stacking the grace on top of the whole token lifetime). The worst case is
// therefore one interval plus one grace, and a client cannot extend it by staying quiet.
//
// Why not a push (publish the bumped user id, every instance drops their sockets)? Because a push
// is lossy and silent when it is lost: a Redis blip, an instance mid-restart, or one revocation
// path whose author forgot the call, and the socket lives forever with nothing to notice it. The
// gateway does offer that push — `gateway.disconnectUser` — but as the *fast* path on top of this
// one, never as the guarantee.
//
// The cost is one indexed query per distinct credential per interval, which is why the sweep
// de-duplicates by token: a user with six tabs open shares one access token and must cost one
// query, not six.
import { setTimeout as delay } from 'node:timers/promises';
import type { Actor } from '../../../platform/http/principal.js';
import type { Logger } from '../../../platform/logger.js';
import { SERVER_EVENTS } from '../domain/protocol.js';
import type { Connection, ConnectionTable } from './connections.js';

export interface RevalidateDeps {
  /** Identity's `resolvePrincipal`, bound to the process's connections. */
  authenticate: (token: string) => Promise<Actor>;
  connections: ConnectionTable;
  logger: Logger;
  /**
   * How long a socket keeps its place after its credential first fails to verify. Past this it is
   * disconnected however politely it has been asked for a fresh one.
   */
  credentialGraceMs: number;
  /**
   * A single check that never settles would leave `Promise.allSettled` pending forever and, with
   * the caller's overlap latch held, stop re-validation for the life of the process — silently.
   * Nothing in this repo sets a Postgres `statement_timeout`, so a query blocked on a lock can do
   * exactly that.
   */
  checkTimeoutMs: number;
  now?: () => number;
}

export interface SweepResult {
  checked: number;
  kept: number;
  disconnected: number;
  refreshRequested: number;
}

/** Rejects rather than hangs, so one stuck query cannot stop re-validation for the whole process. */
async function withTimeout(check: Promise<Actor>, timeoutMs: number): Promise<Actor> {
  const abort = new AbortController();
  const expiry = delay(timeoutMs, undefined, { signal: abort.signal }).then(() => {
    throw new Error(`socket: a credential check did not settle in ${String(timeoutMs)}ms`);
  });
  try {
    return await Promise.race([check, expiry]);
  } finally {
    // Clears the pending timer; without it every sweep leaves one behind until it fires.
    abort.abort();
  }
}

/** Tell the client why, then close. The `auth:revoked` payload mirrors the HTTP 401's problem code. */
export function revoke(connections: ConnectionTable, connection: Connection, code: string): void {
  connection.emit(SERVER_EVENTS.revoked, { code });
  connection.disconnect();
  connections.remove(connection.id);
}

export async function revalidateConnections(deps: RevalidateDeps): Promise<SweepResult> {
  const now = deps.now ?? Date.now;
  const live = deps.connections.all();
  const result: SweepResult = { checked: live.length, kept: 0, disconnected: 0, refreshRequested: 0 };
  if (live.length === 0) return result;

  const byToken = new Map<string, Connection[]>();
  for (const connection of live) {
    byToken.set(connection.token, [...(byToken.get(connection.token) ?? []), connection]);
  }

  const settled = await Promise.allSettled(
    [...byToken].map(async ([token, group]) => ({
      token,
      group,
      actor: await withTimeout(deps.authenticate(token), deps.checkTimeoutMs),
    })),
  );

  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      // A sweep that cannot reach Postgres or Redis must not disconnect the fleet: an outage would
      // become a mass logout. The sockets keep their places, the next sweep retries, and
      // `maxCredentialAgeMs` still bounds how long an unverifiable credential can survive.
      deps.logger.warn({ err: outcome.reason }, 'socket: a credential check failed; keeping the socket');
      continue;
    }

    const { token, group, actor } = outcome.value;
    for (const connection of group) {
      // An `auth:token` may have landed while this check was in flight. A verdict about a credential
      // the socket no longer holds decides nothing; the next sweep reads the new one.
      if (connection.token !== token) continue;
      if (actor.principal !== null) {
        if (actor.principal.userId !== connection.userId) {
          // The same credential now names somebody else. Impossible from a signed token, which is
          // exactly why it is worth refusing rather than trusting: this socket is already sitting
          // in the first user's personal room, and moving it would deliver their pushes elsewhere.
          revoke(deps.connections, connection, 'TOKEN_INVALID');
          result.disconnected += 1;
          continue;
        }
        connection.principal = actor.principal;
        connection.verifiedAt = now();
        connection.credentialExpiredAt = null;
        result.kept += 1;
        continue;
      }

      const failure = actor.failure ?? 'TOKEN_INVALID';
      // An expired token is the one failure that says nothing about the session: the client simply
      // has not forwarded the token its HTTP layer already refreshed. Ask, and keep the connection
      // until the grace window closes — dropping every socket the instant its ten-minute token
      // lapsed would be a reconnect storm every ten minutes, on the worst networks we serve.
      if (failure === 'TOKEN_EXPIRED') {
        if (connection.credentialExpiredAt === null) {
          connection.credentialExpiredAt = now();
          // Asked once per expiry episode. Re-asking every sweep would be twenty-odd identical
          // prompts to a client that has already decided not to answer.
          connection.emit(SERVER_EVENTS.refreshRequired, { code: failure });
          result.refreshRequested += 1;
          continue;
        }
        if (now() - connection.credentialExpiredAt <= deps.credentialGraceMs) continue;
      }

      revoke(deps.connections, connection, failure);
      result.disconnected += 1;
    }
  }

  return result;
}
