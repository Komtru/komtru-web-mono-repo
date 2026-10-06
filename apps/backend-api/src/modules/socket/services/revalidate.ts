// The ticket's hard part: how a long-lived connection learns that its session died.
//
// Over HTTP, nothing about authorisation is cached — `resolvePrincipal` re-reads scope, status,
// epoch, roles and permissions from Postgres on *every request*, so revoking a session or bumping
// `users.sessions_epoch` stops the caller on their next request. A socket has no next request. It
// can sit open for hours having been authenticated exactly once, which is precisely the shape of
// bug M1 D5's kill switch exists to prevent.
//
// So the gateway manufactures the missing request. Every socket keeps the credential it presented,
// and on a fixed interval this sweep re-runs the *same* `resolvePrincipal` over it. A socket's
// authorisation is therefore never more than one interval stale, the verdicts are literally the
// HTTP verdicts — one code path, no second authorisation path to drift — and the mechanism depends
// on nothing but this process being alive.
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
   * Access-token TTL plus the configured grace. Past this a socket that has not re-presented a
   * live credential is disconnected, however politely it was asked.
   */
  maxCredentialAgeMs: number;
  now?: () => number;
}

export interface SweepResult {
  checked: number;
  kept: number;
  disconnected: number;
  refreshRequested: number;
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
    [...byToken].map(async ([token, group]) => ({ group, actor: await deps.authenticate(token) })),
  );

  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      // A sweep that cannot reach Postgres or Redis must not disconnect the fleet: an outage would
      // become a mass logout. The sockets keep their places, the next sweep retries, and
      // `maxCredentialAgeMs` still bounds how long an unverifiable credential can survive.
      deps.logger.warn({ err: outcome.reason }, 'socket: a credential check failed; keeping the socket');
      continue;
    }

    const { group, actor } = outcome.value;
    for (const connection of group) {
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
        result.kept += 1;
        continue;
      }

      const failure = actor.failure ?? 'TOKEN_INVALID';
      // An expired token is the one failure that says nothing about the session: the client simply
      // has not forwarded the token its HTTP layer already refreshed. Ask, and keep the connection
      // until the grace window closes — dropping every socket the instant its ten-minute token
      // lapsed would be a reconnect storm every ten minutes, on the worst networks we serve.
      if (failure === 'TOKEN_EXPIRED' && now() - connection.verifiedAt <= deps.maxCredentialAgeMs) {
        connection.emit(SERVER_EVENTS.refreshRequired, { code: failure });
        result.refreshRequested += 1;
        continue;
      }

      revoke(deps.connections, connection, failure);
      result.disconnected += 1;
    }
  }

  return result;
}
