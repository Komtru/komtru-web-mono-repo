// The socket module's public surface (T-027).
//
// One Socket.IO server for the whole backend: authenticated with the same access token the HTTP API
// trusts, fanned out across instances by the Redis adapter, and reachable from any other module
// through `gateway` — which is the only thing they ever touch. The komtru/module-boundaries rule
// makes this file the only way in.
//
// The module is built without the HTTP server on purpose. `createModules` is a pure function of the
// process's connections and configuration, and a module that demanded a *listening* server would
// force the registry to be built after `listen` — reordering boot around one module. Instead the
// server is created unattached here and `server.ts` calls `socketModuleOf(modules)?.attach(server)`
// in one line after it starts listening.
import type { Server as IoServer } from 'socket.io';
import type { AppConfig } from '../../config/env.js';
import type { Actor } from '../../platform/http/principal.js';
import type { Logger } from '../../platform/logger.js';
import { defineModule, type KomtruModule } from '../../platform/module.js';
import type { Closer } from '../../platform/shutdown.js';
import { createAuthorizerRegistry } from './services/authorizers.js';
import { createConnectionTable } from './services/connections.js';
import { createGateway, type SocketGateway } from './services/gateway.js';
import {
  authenticateHandshake,
  onConnection,
  type GatewaySocket,
  type HandlerDeps,
} from './services/handlers.js';
import { revalidateConnections } from './services/revalidate.js';
import { createAdapterConnections } from './infrastructure/redis.js';
import { createSocketServer, socketAdapterKey } from './infrastructure/server.js';

export { socketAdapterKey } from './infrastructure/server.js';
export { RESERVED_ROOM_PREFIXES, personalRoom, scopeRoom } from './domain/rooms.js';
export { CLIENT_EVENTS, SERVER_EVENTS } from './domain/protocol.js';
export type { RoomAuthorizer, RoomAuthorizerInput } from './services/authorizers.js';
export type { SocketGateway } from './services/gateway.js';

/**
 * The HTTP server Socket.IO rides on, taken from socket.io's own signature rather than imported
 * from `node:http`. Module code may not import `node:http` — the provider-clients rule and
 * test/support/provider-imports.ts both read that as "this file reaches the network directly" —
 * and this module genuinely does not: it is handed a server somebody else is already listening on.
 * `number` is excluded because that overload would have Socket.IO open a port of its own, which is
 * the one thing this module must never do.
 */
export type AttachableServer = Exclude<Parameters<IoServer['attach']>[0], number>;

export interface SocketModuleDeps {
  config: AppConfig;
  logger: Logger;
  /**
   * Identity's `resolvePrincipal`, bound to this process's connections. The whole point of taking
   * it as a port: the gateway's verdicts are the HTTP path's verdicts, decided by the same query,
   * rather than a second authorisation path that can drift from it.
   */
  authenticate: (token: string) => Promise<Actor>;
}

export interface SocketModule extends KomtruModule {
  /** Called once by server.ts after listen(). A no-op when SOCKET_ENABLED is false. */
  attach: (server: AttachableServer) => void;
  /** Closes every live socket. Runs before the HTTP drain; see `socketDrain`. */
  drain: () => void;
  gateway: SocketGateway;
}

/**
 * The closer that must run BEFORE the HTTP drain. `server.close()` never completes while a
 * websocket is open and `closeIdleConnections()` does not touch an upgraded connection, so without
 * this every shutdown waits out the full drain timeout and then destroys the sockets abruptly —
 * which a reconnecting client answers by immediately retrying against a dying instance. Closing
 * them first leaves the drain nothing to wait for, and the client sees a clean disconnect.
 */
export const socketDrain = (modules: KomtruModule[]): Closer[] => {
  const module = socketModuleOf(modules);
  return module ? [{ name: 'socket:drain', close: () => Promise.resolve(module.drain()) }] : [];
};

/** The registry's socket module, if this process has one. */
export const socketModuleOf = (modules: KomtruModule[]): SocketModule | undefined =>
  modules.find(
    (module): module is SocketModule =>
      'attach' in module && 'gateway' in module && typeof module.attach === 'function',
  );

/** A gateway for a process that serves no sockets: every call is safe and nothing is allocated. */
function inertGateway(logger: Logger): SocketGateway {
  const ignored = (event: string) =>
    void logger.debug({ event }, 'socket: the gateway is disabled; dropping an emit');
  return {
    emitToUser: (_userId, event) => ignored(event),
    emitToRoom: (_prefix, _id, event) => ignored(event),
    // Still throws on a duplicate or reserved prefix: a module's registration is a boot-time
    // assertion about room ownership, and disabling the gateway must not disable that check.
    registerRoomAuthorizer: createAuthorizerRegistry(logger).register,
    disconnectUser: () => {},
    connectionCount: () => 0,
  };
}

export function createSocketModule(deps: SocketModuleDeps): SocketModule {
  const { config, logger } = deps;
  if (!config.socket.enabled) {
    return Object.assign(defineModule({ name: 'socket' }), {
      attach: () => {},
      drain: () => {},
      gateway: inertGateway(logger),
    });
  }

  const connections = createConnectionTable();
  const authorizers = createAuthorizerRegistry(logger);
  const adapter = createAdapterConnections(config.redis.url);
  const adapterKey = socketAdapterKey(config.redis.keyPrefix);
  const io = createSocketServer(config.socket, adapter, logger, adapterKey);
  const gateway = createGateway({ io, authorizers, connections, logger });

  const handlerDeps: HandlerDeps = {
    authenticate: deps.authenticate,
    authorizers,
    connections,
    logger,
  };

  io.use((socket, next) => {
    void authenticateHandshake(handlerDeps, socket as unknown as GatewaySocket).then(
      (error) => void (error ? next(error) : next()),
      (error: unknown) => {
        // Postgres or Redis unreachable during a handshake. Refuse rather than admit: an
        // unauthenticated socket in a personal room is the one outcome worth avoiding.
        logger.error({ err: error }, 'socket: the handshake could not be authenticated');
        next(new Error('UNAVAILABLE'));
      },
    );
  });

  // Rooms and bookkeeping happen here rather than in the middleware: socket.io abandons a socket
  // whose transport died mid-handshake without firing `disconnect`, so a table filled in there
  // would leak an entry per aborted connection.
  io.on('connection', (socket) => void onConnection(handlerDeps, socket as unknown as GatewaySocket));

  const revalidateIntervalMs = config.socket.revalidateIntervalSeconds * 1000;

  let timer: NodeJS.Timeout | undefined;
  let sweeping = false;
  // `io.close()` reaches into the engine `attach` creates, so closing a server that never attached
  // throws — which is the shape of a boot that failed between building the registry and listening.
  let attached = false;

  const sweep = async (): Promise<void> => {
    // A sweep that overruns its interval must not stack: the next tick would double the query load
    // on exactly the database that was already slow.
    if (sweeping) return;
    sweeping = true;
    try {
      const result = await revalidateConnections({
        authenticate: deps.authenticate,
        connections,
        logger,
        credentialGraceMs: config.socket.credentialGraceSeconds * 1000,
        // A check that outlives the interval it was started in has already missed its sweep.
        checkTimeoutMs: revalidateIntervalMs,
      });
      if (result.disconnected > 0 || result.refreshRequested > 0) {
        logger.info(result, 'socket: re-validated live connections');
      }
    } catch (error) {
      logger.error({ err: error }, 'socket: the re-validation sweep failed');
    } finally {
      sweeping = false;
    }
  };

  return Object.assign(
    defineModule({
      name: 'socket',
      start: () => {
        // `unref` so an idle timer never holds the process open — which is what makes a test's
        // `stop()` deterministic and a SIGTERM prompt.
        timer = setInterval(() => void sweep(), revalidateIntervalMs);
        timer.unref();
        logger.info(
          {
            path: config.socket.path,
            adapterKey,
            revalidateIntervalSeconds: config.socket.revalidateIntervalSeconds,
          },
          'socket: gateway ready',
        );
        return Promise.resolve();
      },
      stop: async () => {
        if (timer) clearInterval(timer);
        timer = undefined;
        // Closes the engine. It also calls close() on the shared HTTP server, which by this point
        // server.ts has already drained — harmless, and the reason this runs after the drain.
        if (attached) await io.close();
        await adapter.close();
      },
    }),
    {
      attach: (server: AttachableServer) => {
        io.attach(server);
        attached = true;
      },
      drain: () => {
        if (attached) io.disconnectSockets(true);
      },
      gateway,
    },
  );
}
