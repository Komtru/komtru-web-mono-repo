// The Redis adapter's own pub/sub connections.
//
// Deliberately not the platform's app client. That one sets `enableOfflineQueue: false` so an HTTP
// request fails fast while Redis reconnects — the right trade for a request with a caller waiting,
// and the wrong one for a broadcast channel, where failing fast just drops the message. A client in
// subscriber mode also cannot be shared: once subscribed it accepts no other commands.
//
// ioredis's `keyPrefix` does not apply to pub/sub channel names, so the `komtru:sock:` prefix the
// ticket pins comes from the adapter's own `key` option (see server.ts), not from here.
import { Redis } from 'ioredis';

export interface AdapterConnections {
  pub: Redis;
  sub: Redis;
  close: () => Promise<void>;
}

/**
 * How long a graceful `QUIT` may take before the socket is torn down instead.
 *
 * Long enough that a Redis which is merely busy still gets to answer and flush, short enough that
 * a shutdown is never held open by one that is gone.
 */
const QUIT_DEADLINE_MS = 2_000;

/**
 * Ends one client, gracefully if Redis is answering and abruptly if it is not.
 *
 * `quit()` is a command, not a socket operation: it joins the offline queue, behind the
 * `psubscribe` the Socket.IO adapter issues the moment the module is built. Nothing in that queue
 * runs until the client connects, and with `maxRetriesPerRequest: null` and ioredis's default
 * retry strategy it reconnects forever — so against an unreachable Redis the returned promise has
 * no path to settling. Shutdown then hangs: in the API that is a drain which never completes, and
 * in the repo workflow's Redis-less step it was ten socket tests all failing on a timed-out
 * teardown that had nothing to do with them.
 *
 * `disconnect()` is the socket operation, and it always ends the client.
 */
async function endClient(client: Redis): Promise<void> {
  // Settled either way: a rejected QUIT is still a closed connection, and nothing here may throw
  // into a shutdown path.
  const quit = client.quit().then(
    () => true,
    () => true,
  );
  const deadline = new Promise<boolean>((resolve) => {
    // `unref` so the deadline itself never holds the process open.
    setTimeout(() => resolve(false), QUIT_DEADLINE_MS).unref();
  });
  if (!(await Promise.race([quit, deadline]))) client.disconnect();
}

export function createAdapterConnections(url: string): AdapterConnections {
  // `maxRetriesPerRequest: null` because a broadcast has no user waiting on a deadline: queueing
  // through a reconnect is better than throwing a message away.
  const pub = new Redis(url, { maxRetriesPerRequest: null });
  const sub = pub.duplicate();
  // A dropped connection must not crash the API; readiness reports Redis separately.
  pub.on('error', () => {});
  sub.on('error', () => {});

  return {
    pub,
    sub,
    close: async () => void (await Promise.all([endClient(pub), endClient(sub)])),
  };
}
