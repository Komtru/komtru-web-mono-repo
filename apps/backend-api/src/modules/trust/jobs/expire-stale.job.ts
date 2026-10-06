// §6.2's floor: a request a provider never answered must not hold a user's one in-flight slot
// forever, and must never turn into a level.
import { VERIFICATION_SOCKET_EVENT } from '../domain/queues.js';
import type { TrustJobDeps } from './deps.js';

export interface ExpireStaleResult {
  expired: number;
}

export async function runExpireStale(deps: TrustJobDeps, firedAt: Date): Promise<ExpireStaleResult> {
  const expired = await deps.store.expireStale(firedAt);
  if (expired.length === 0) return { expired: 0 };

  deps.logger.info({ expired: expired.length }, 'trust: expired verification requests nobody answered');
  for (const request of expired) {
    // Expiry grants nothing — it is the absence of an answer, not a negative one. The push is so a
    // screen that has been showing a spinner since yesterday stops.
    deps.gateway.emitToUser(request.userId, VERIFICATION_SOCKET_EVENT, {
      requestId: request.requestId,
      type: request.verificationType,
      status: 'EXPIRED',
    });
  }
  return { expired: expired.length };
}
