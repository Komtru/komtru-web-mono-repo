// The socket lifecycle with no React in it, so the rules that matter — resync on reconnect but not
// on the first connect, and every listener removed on teardown — are provable without a renderer.
//
// `SocketLike` is the slice of socket.io-client this package uses. Typing it structurally keeps
// `socket.io-client` out of the isomorphic entry point entirely: only `@komtru/api-client/react`
// ever imports the real thing.

/**
 * Method syntax on purpose: it is bivariant, so a handler typed for the payload it expects —
 * `(parcel: Parcel) => void` — is accepted without a cast at every call site.
 */
export interface SocketEmitter {
  on(event: string, handler: (...args: never[]) => void): void;
  off(event: string, handler: (...args: never[]) => void): void;
}

export interface SocketLike extends SocketEmitter {
  disconnect: () => void;
  /** Fire and forget: `auth:token` is sent this way. */
  emit: (event: string, ...args: unknown[]) => unknown;
  /** Resolves with the server's acknowledgement; `room:join` is asked this way. */
  emitWithAck: (event: string, ...args: unknown[]) => Promise<unknown>;
  /** The manager, which is what emits `reconnect` once a dropped connection comes back. */
  io: SocketEmitter;
}

export interface RealtimeConnectionOptions {
  socket: SocketLike;
  onConnectedChange?: (connected: boolean) => void;
  /**
   * Called on every reconnect, never on the first connect. A live event is "something changed, go
   * check" — the real history is always behind the API (socket guide §9).
   */
  onResync?: () => void;
}

export interface RealtimeConnection {
  /** Subscribes to one event; the returned function unsubscribes. */
  on: <T = unknown>(event: string, handler: (payload: T) => void) => () => void;
  /** Removes every listener this attachment added and disconnects the socket. */
  close: () => void;
}

type AnyHandler = (...args: never[]) => void;

export function attachRealtime({
  socket,
  onConnectedChange,
  onResync,
}: RealtimeConnectionOptions): RealtimeConnection {
  const added: { target: SocketEmitter; event: string; handler: AnyHandler }[] = [];

  const listen = (target: SocketEmitter, event: string, handler: AnyHandler): (() => void) => {
    target.on(event, handler);
    const entry = { target, event, handler };
    added.push(entry);
    return () => {
      target.off(event, handler);
      const index = added.indexOf(entry);
      if (index >= 0) added.splice(index, 1);
    };
  };

  if (onConnectedChange) {
    listen(socket, 'connect', () => onConnectedChange(true));
    listen(socket, 'disconnect', () => onConnectedChange(false));
  }
  if (onResync) listen(socket.io, 'reconnect', () => onResync());

  return {
    on: <T>(event: string, handler: (payload: T) => void) =>
      listen(socket, event, (payload: T) => handler(payload)),
    close: () => {
      for (const { target, event, handler } of [...added]) target.off(event, handler);
      added.length = 0;
      socket.disconnect();
    },
  };
}
