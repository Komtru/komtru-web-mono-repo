// This instance's live sockets, reduced to what re-validation needs.
//
// It exists so the sweep in revalidate.ts is a pure function of data and two ports (`emit`,
// `disconnect`) rather than a walk over socket.io's internals. The table is per-instance by
// definition: a socket belongs to the process holding its TCP connection, and nothing else can
// disconnect it directly — which is why the gateway's cross-instance `disconnectUser` goes through
// the Redis adapter instead of through here.
import type { Principal } from '../../../platform/http/principal.js';

export interface Connection {
  /** `socket.id`. */
  id: string;
  userId: string;
  sessionId: string;
  /**
   * The credential this socket most recently presented — at handshake, or later through
   * `auth:token`. Kept because it is the only thing that lets the gateway ask identity the same
   * question an HTTP request asks, with the same answer.
   */
  token: string;
  /** When `authenticate` last returned a principal for this socket (epoch milliseconds). */
  verifiedAt: number;
  /** Re-read from Postgres at handshake and on every sweep; never decoded from the token. */
  principal: Principal;
  emit: (event: string, payload: unknown) => void;
  disconnect: () => void;
}

export interface ConnectionTable {
  add: (connection: Connection) => void;
  remove: (id: string) => void;
  get: (id: string) => Connection | undefined;
  all: () => Connection[];
  size: () => number;
}

export function createConnectionTable(): ConnectionTable {
  const connections = new Map<string, Connection>();

  return {
    add: (connection) => void connections.set(connection.id, connection),
    remove: (id) => void connections.delete(id),
    get: (id) => connections.get(id),
    // A copy: the sweep disconnects as it goes, and removing from a map being iterated is how a
    // socket gets silently skipped.
    all: () => [...connections.values()],
    size: () => connections.size,
  };
}
