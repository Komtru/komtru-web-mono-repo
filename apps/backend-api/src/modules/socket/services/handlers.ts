// The handshake and the per-connection listeners.
//
// Authentication here is not a second identity system (guide §6, design §7.3): the credential goes
// to the *same* `resolvePrincipal` an HTTP request's Authorization header goes to, and the socket
// is admitted on exactly the conditions a request would be. Everything the connection then knows
// about the caller — id, scope, roles — comes off that resolved principal and never off a field
// the client supplied.
import type { Logger } from '../../../platform/logger.js';
import type { Actor, Principal } from '../../../platform/http/principal.js';
import { CLIENT_EVENTS, roomRequestSchema, tokenRequestSchema, type JoinAck } from '../domain/protocol.js';
import { featureRoom, isJoinableRoom, roomsForPrincipal } from '../domain/rooms.js';
import type { AuthorizerRegistry } from './authorizers.js';
import type { Connection, ConnectionTable } from './connections.js';
import { revoke } from './revalidate.js';

/** The slice of socket.io's `Socket` the handlers use, so the tests need no server. */
export interface GatewaySocket {
  id: string;
  handshake: { auth: Record<string, unknown>; headers: Record<string, unknown> };
  join: (room: string) => unknown;
  leave: (room: string) => unknown;
  emit: (event: string, payload: unknown) => unknown;
  disconnect: (close: boolean) => unknown;
  on: (event: string, listener: (...args: never[]) => void) => unknown;
  data: Record<string, unknown>;
}

export interface HandlerDeps {
  authenticate: (token: string) => Promise<Actor>;
  authorizers: AuthorizerRegistry;
  connections: ConnectionTable;
  logger: Logger;
}

const BEARER = /^Bearer (\S+)$/;

/**
 * `handshake.auth.token` first (what the Socket.IO client sends), then the Authorization header for
 * a client that cannot set `auth`. Never a query parameter, for the same reason T-031's
 * `bearerToken` refuses one: a token in a query string lands in access logs and referrers.
 */
export function credentialFrom(handshake: GatewaySocket['handshake']): string | undefined {
  const supplied = handshake.auth.token;
  if (typeof supplied === 'string' && supplied.length > 0) return supplied;
  const header = handshake.headers.authorization;
  return typeof header === 'string' ? (BEARER.exec(header)?.[1] ?? undefined) : undefined;
}

/** Socket.IO's middleware convention: an Error refuses the connection, `undefined` admits it. */
const refusal = (code: string): Error => Object.assign(new Error(code), { data: { code } });

const record = (
  deps: HandlerDeps,
  socket: GatewaySocket,
  principal: Principal,
  token: string,
): Connection => {
  const connection: Connection = {
    id: socket.id,
    userId: principal.userId,
    sessionId: principal.sessionId,
    token,
    verifiedAt: Date.now(),
    credentialExpiredAt: null,
    principal,
    emit: (event, payload) => void socket.emit(event, payload),
    disconnect: () => void socket.disconnect(true),
  };
  deps.connections.add(connection);
  return connection;
};

/**
 * A client may put anything in the ack slot — socket.io hands the listener whatever arrived. Calling
 * a string is a TypeError inside an event handler, which `platform/run.ts` turns into a process
 * exit: one crafted packet from any authenticated client would take the instance down.
 */
const ackOr =
  <T>(ack: unknown): ((result: T) => void) =>
  (result) => {
    if (typeof ack === 'function') (ack as (r: T) => void)(result);
  };

/**
 * Nothing a listener does may escape it, for the same reason. An await that rejects — Postgres away
 * during an `auth:token`, a bug in a payload parser — becomes an unhandled rejection and the same
 * process exit, so every listener body ends here.
 */
const contained = (deps: HandlerDeps, event: string, body: () => Promise<void> | void): void => {
  void (async () => {
    try {
      await body();
    } catch (error) {
      deps.logger.error({ err: error, event }, 'socket: a client event handler failed');
    }
  })();
};

/**
 * Admits or refuses a connection. Returns the Error socket.io's `io.use` expects, whose `message`
 * is the same `AuthFailure` code the HTTP 401 would carry — so a client can tell "refresh and
 * retry" (`TOKEN_EXPIRED`) from "you are signed out" (`SESSION_REVOKED`) without parsing prose.
 *
 * It deliberately records nothing. A socket whose transport dies while this middleware is awaiting
 * is cleaned up by socket.io *without* firing `disconnect`, so anything added to the connection
 * table here would never be removed — a connect-and-abort loop, or just a bad mobile network, would
 * grow it without bound. The principal is parked on `socket.data` and promoted by `onConnection`,
 * which socket.io only calls for a socket it has actually committed.
 */
export async function authenticateHandshake(
  deps: HandlerDeps,
  socket: GatewaySocket,
): Promise<Error | undefined> {
  const token = credentialFrom(socket.handshake);
  if (token === undefined) return refusal('TOKEN_MISSING');

  const actor = await deps.authenticate(token);
  if (actor.principal === null) return refusal(actor.failure ?? 'TOKEN_INVALID');

  socket.data.principal = actor.principal;
  socket.data.token = token;
  // Diagnostics only. Nothing reads authorisation off `socket.data` afterwards; the connection
  // table holds the principal, and the sweep keeps it current.
  socket.data.userId = actor.principal.userId;
  socket.data.scope = actor.principal.scope;
  return undefined;
}

/** Runs on `connection`: the socket is committed, so this is where it joins rooms and is recorded. */
export function onConnection(deps: HandlerDeps, socket: GatewaySocket): void {
  const principal = socket.data.principal as Principal | undefined;
  const token = socket.data.token as string | undefined;
  if (!principal || token === undefined) {
    // Unreachable while `io.use` is the only way in, and a closed door if it ever stops being.
    deps.logger.error({ socketId: socket.id }, 'socket: a connection arrived with no principal');
    socket.disconnect(true);
    return;
  }
  const connection = record(deps, socket, principal, token);
  for (const room of roomsForPrincipal(principal)) socket.join(room);
  attachSocket(deps, socket, connection);
}

export function attachSocket(deps: HandlerDeps, socket: GatewaySocket, connection: Connection): void {
  // Every listener answers its ack rather than throwing: an unparseable payload from a client is a
  // normal event on a public interface, not an exception for the server to fall over on.
  socket.on(CLIENT_EVENTS.joinRoom, (payload: unknown, ack: unknown) => {
    const reply = ackOr<JoinAck>(ack);
    contained(deps, CLIENT_EVENTS.joinRoom, async () => {
      reply(await joinRoom(deps, socket, connection, payload));
    });
  });

  socket.on(CLIENT_EVENTS.leaveRoom, (payload: unknown, ack: unknown) => {
    const reply = ackOr<JoinAck>(ack);
    contained(deps, CLIENT_EVENTS.leaveRoom, () => {
      const parsed = roomRequestSchema.safeParse(payload);
      if (parsed.success && isJoinableRoom(parsed.data.prefix, parsed.data.id)) {
        socket.leave(featureRoom(parsed.data.prefix, parsed.data.id));
      }
      // Leaving is idempotent and carries no authorisation: the only thing worth refusing is a name
      // this gateway would never have let the socket join, which `isJoinableRoom` already covers.
      reply({ joined: false });
    });
  });

  socket.on(CLIENT_EVENTS.token, (payload: unknown, ack: unknown) => {
    const reply = ackOr<{ accepted: boolean }>(ack);
    contained(deps, CLIENT_EVENTS.token, async () => {
      reply({ accepted: await replaceCredential(deps, connection, payload) });
    });
  });

  socket.on('disconnect', () => deps.connections.remove(socket.id));
}

async function joinRoom(
  deps: HandlerDeps,
  socket: GatewaySocket,
  connection: Connection,
  payload: unknown,
): Promise<JoinAck> {
  const parsed = roomRequestSchema.safeParse(payload);
  if (!parsed.success) return { joined: false, reason: 'INVALID_ROOM' };
  const { prefix, id } = parsed.data;
  // Refused before any authorizer is consulted: `user:`/`staff:`/… are personal rooms, and a
  // feature module must never be in a position to admit somebody to one.
  if (!isJoinableRoom(prefix, id)) return { joined: false, reason: 'INVALID_ROOM' };

  const allowed = await deps.authorizers.authorize({
    userId: connection.userId,
    scope: connection.principal.scope,
    principal: connection.principal,
    prefix,
    id,
  });
  if (!allowed) return { joined: false, reason: 'FORBIDDEN' };
  socket.join(featureRoom(prefix, id));
  return { joined: true };
}

/**
 * The client forwarding the access token its HTTP layer just refreshed. This is what keeps a
 * long-lived socket from ever reaching the grace deadline in revalidate.ts, and it re-runs the full
 * principal resolution, so a client that refreshes after a revocation is disconnected here rather
 * than at the next sweep.
 */
async function replaceCredential(
  deps: HandlerDeps,
  connection: Connection,
  payload: unknown,
): Promise<boolean> {
  const parsed = tokenRequestSchema.safeParse(payload);
  if (!parsed.success) return false;

  let actor;
  try {
    actor = await deps.authenticate(parsed.data.token);
  } catch (error) {
    // Postgres or Redis away. Keep the socket on the credential it already has: an outage must not
    // become a mass logout, and the sweep's grace window still bounds how long that can last.
    deps.logger.warn({ err: error }, 'socket: could not verify a re-presented credential');
    return false;
  }

  if (actor.principal === null) {
    revoke(deps.connections, connection, actor.failure ?? 'TOKEN_INVALID');
    return false;
  }
  // A credential for somebody else is not an upgrade path. This socket already sits in the first
  // user's personal room; accepting would deliver their pushes to whoever sent this.
  //
  // Nor a credential for the same person under a *different scope*. The scope rooms are joined once,
  // at connection, and nothing re-joins them — so accepting a STAFF token on a socket that joined
  // `consumer:<id>` would leave a staff principal out of the staff room, or worse, leave a consumer
  // principal in it after the staff session is revoked. Scope is an identity boundary in this
  // design (T-031's isolation suite); crossing it costs a reconnect.
  if (actor.principal.userId !== connection.userId || actor.principal.scope !== connection.principal.scope) {
    revoke(deps.connections, connection, 'TOKEN_INVALID');
    return false;
  }

  connection.token = parsed.data.token;
  connection.principal = actor.principal;
  connection.verifiedAt = Date.now();
  connection.credentialExpiredAt = null;
  return true;
}
