// The Socket.IO server itself, built *unattached*.
//
// `new Server(options)` with no HTTP server is what lets the module exist before the process is
// listening: the registry stays a pure function of its dependencies, and server.ts adds one line
// (`attach`) after `listen` rather than reordering its boot sequence around this module.
import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';
import type { SocketConfig } from '../../../config/env.js';
import type { Logger } from '../../../platform/logger.js';
import type { AdapterConnections } from './redis.js';

/**
 * Every key and channel the adapter touches begins with this (it composes channel names as
 * `<key>#<namespace>#`), which is what keeps the socket layer's pub/sub off BullMQ's `komtru:bull`
 * keyspace on the shared instance.
 */
export const SOCKET_ADAPTER_KEY = 'komtru:sock:';

export function createSocketServer(
  config: SocketConfig,
  connections: AdapterConnections,
  logger: Logger,
): Server {
  if (config.corsOrigins.length === 0) {
    // Not fatal: a Node client (and every integration test) sends no Origin and connects fine. But
    // in a browser the symptom is a handshake that fails with nothing in the API's logs, so the
    // variable gets named here rather than discovered in a devtools console.
    logger.warn(
      'socket: SOCKET_CORS_ORIGINS and ALLOWED_ORIGINS are both empty; no browser will be able to connect',
    );
  }

  const io = new Server({
    path: config.path,
    // An explicit allowlist, never a wildcard (guide §12).
    cors: { origin: config.corsOrigins, credentials: true },
    // The API serves no client bundle; the apps install socket.io-client themselves.
    serveClient: false,
  });

  io.adapter(createAdapter(connections.pub, connections.sub, { key: SOCKET_ADAPTER_KEY }));
  return io;
}
