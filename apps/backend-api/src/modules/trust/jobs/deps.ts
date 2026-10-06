// What the jobs need, bound once in module.ts.
//
// Note what is NOT here: a `Db`. Every write goes through the store port, so a job is testable with
// no database, and the adapter arrives already chosen — this is the only directory that may hold one
// (T-028), and the choice was made at boot where a missing credential names itself.
import type { Encryption } from '../../../platform/crypto/encryption.js';
import type { HmacHasher } from '../../../platform/crypto/hmac.js';
import type { Logger } from '../../../platform/logger.js';
import type { SocketGateway } from '../../socket/index.js';
import type { KycProviderAdapter } from '../domain/provider.js';
import type { TrustStore } from '../infrastructure/postgres/store.js';

export interface TrustJobDeps {
  store: TrustStore;
  adapter: KycProviderAdapter;
  hasher: HmacHasher;
  encryption: Encryption;
  gateway: SocketGateway;
  logger: Logger;
}

/** What a client is told over the socket when a verification reaches an answer. */
export const VERIFICATION_SOCKET_EVENT = 'verification:updated';
