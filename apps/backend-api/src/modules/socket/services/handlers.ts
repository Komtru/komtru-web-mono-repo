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
    principal,
    emit: (event, payload) => void socket.emit(event, payload),
    disconnect: () => void socket.disconnect(true),
  };
  deps.connections.add(connection);
  return connection;
};

/**
 * Admits or refuses a connection, and on admission joins the personal rooms, records the
 * connection and registers the listeners. Returns the Error socket.io's `io.use` expects, whose
 * `message` is the same `AuthFailure` code the HTTP 401 would carry — so a client can tell
 * "refresh and retry" (`TOKEN_EXPIRED`) from "you are signed out" (`SESSION_REVOKED`) without
 * parsing prose.
 */
export async function authenticateHandshake(
  deps: HandlerDeps,
  socket: GatewaySocket,
): Promise<Error | undefined> {
  const token = credentialFrom(socket.handshake);
  if (token === undefined) return refusal('TOKEN_MISSING');

  const actor = await deps.authenticate(token);
  if (actor.principal === null) return refusal(actor.failure ?? 'TOKEN_INVALID');

  const connection = record(deps, socket, actor.principal, token);
  for (const room of roomsForPrincipal(actor.principal)) socket.join(room);
  // Diagnostics only. Nothing reads authorisation off `socket.data`; the connection table holds the
  // principal, and the sweep keeps it current.
  socket.data.userId = actor.principal.userId;
  socket.data.scope = actor.principal.scope;
  attachSocket(deps, socket, connection);
  return undefined;
}

export function attachSocket(deps: HandlerDeps, socket: GatewaySocket, connection: Connection): void {
  // Every listener answers its ack rather than throwing: an unparseable payload from a client is a
  // normal event on a public interface, not an exception for the server to fall over on.
  socket.on(CLIENT_EVENTS.joinRoom, (payload: unknown, ack?: (result: JoinAck) => void) => {
    void (async () => {
      const answer = await joinRoom(deps, socket, connection, payload);
      ack?.(answer);
    })();
  });

  socket.on(CLIENT_EVENTS.leaveRoom, (payload: unknown, ack?: (result: JoinAck) => void) => {
    const parsed = roomRequestSchema.safeParse(payload);
    if (parsed.success && isJoinableRoom(parsed.data.prefix, parsed.data.id)) {
      socket.leave(featureRoom(parsed.data.prefix, parsed.data.id));
    }
    // Leaving is idempotent and carries no authorisation: the only thing worth refusing is a name
    // this gateway would never have let the socket join, which `isJoinableRoom` already covers.
    ack?.({ joined: false });
  });

  socket.on(CLIENT_EVENTS.token, (payload: unknown, ack?: (result: { accepted: boolean }) => void) => {
    void (async () => {
      const accepted = await replaceCredential(deps, connection, payload);
      ack?.({ accepted });
    })();
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

  const actor = await deps.authenticate(parsed.data.token);
  if (actor.principal === null) {
    revoke(deps.connections, connection, actor.failure ?? 'TOKEN_INVALID');
    return false;
  }
  // A credential for somebody else is not an upgrade path. This socket already sits in the first
  // user's personal room; accepting would deliver their pushes to whoever sent this.
  if (actor.principal.userId !== connection.userId) {
    revoke(deps.connections, connection, 'TOKEN_INVALID');
    return false;
  }

  connection.token = parsed.data.token;
  connection.principal = actor.principal;
  connection.verifiedAt = Date.now();
  return true;
}
