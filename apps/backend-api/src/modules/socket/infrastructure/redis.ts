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
    close: async () => void (await Promise.allSettled([pub.quit(), sub.quit()])),
  };
}
