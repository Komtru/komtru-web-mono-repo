// What every other module calls. Nothing outside this folder touches `io`.
//
// The guide's §9 keeps `io` in a module-level `let` filled in at boot; this is the same surface
// built per instance instead, so two gateways in one process (two API instances in an integration
// test) cannot overwrite each other's server.
import type { SessionScope } from '@komtru/shared-types';
import type { Logger } from '../../../platform/logger.js';
import { featureRoom, personalRoom, scopeRoom } from '../domain/rooms.js';
import type { AuthorizerRegistry, RoomAuthorizer } from './authorizers.js';
import type { ConnectionTable } from './connections.js';

/** The slice of socket.io's `Server` the gateway uses — so a test needs no server to exercise it. */
export interface Broadcaster {
  to: (room: string) => {
    emit: (event: string, payload: unknown) => void;
    disconnectSockets: (close: boolean) => void;
  };
}

export interface SocketGateway {
  /** To every socket this user holds, on every instance. `scope` narrows it to one way in. */
  emitToUser: (userId: string, event: string, payload: unknown, options?: { scope?: SessionScope }) => void;
  emitToRoom: (prefix: string, id: string, event: string, payload: unknown) => void;
  /** Called once at start by the module owning the prefix (trade, dispute, hub). */
  registerRoomAuthorizer: (prefix: string, authorizer: RoomAuthorizer) => void;
  /**
   * Drops every socket this user holds, everywhere — the Redis adapter carries `disconnectSockets`
   * to the other instances. This is the *fast* path for a revocation the caller already knows
   * about (T-039's suspend, right after the kill-switch transaction commits). It is deliberately
   * not the guarantee: a dropped pub/sub message or a forgotten call site would leave the socket
   * alive, so services/revalidate.ts re-checks every connection on a timer regardless.
   */
  disconnectUser: (userId: string, reason: string) => void;
  /** This instance's sockets only. Diagnostics, not a cluster-wide count. */
  connectionCount: () => number;
}

export interface GatewayDeps {
  io: Broadcaster;
  authorizers: AuthorizerRegistry;
  connections: ConnectionTable;
  logger: Logger;
}

export function createGateway(deps: GatewayDeps): SocketGateway {
  return {
    emitToUser: (userId, event, payload, options) => {
      const room = options?.scope ? scopeRoom(options.scope, userId) : personalRoom(userId);
      deps.io.to(room).emit(event, payload);
    },

    // `featureRoom` throws on a name no client could have joined. A backend caller passing junk is
    // a bug worth surfacing: the alternative is a broadcast into an empty room, which looks like a
    // broken feature and nothing like a bad argument.
    emitToRoom: (prefix, id, event, payload) => void deps.io.to(featureRoom(prefix, id)).emit(event, payload),

    registerRoomAuthorizer: (prefix, authorizer) => void deps.authorizers.register(prefix, authorizer),

    disconnectUser: (userId, reason) => {
      deps.logger.info({ userId, reason }, 'socket: disconnecting every socket for a user');
      deps.io.to(personalRoom(userId)).disconnectSockets(true);
    },

    connectionCount: () => deps.connections.size(),
  };
}
