// The identity module's public surface: the schema other modules read, the session service they
// call, and the actor resolver the API process hands to `mountRoutes`.
import type { Redis } from 'ioredis';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/index.js';
import type { Logger } from '../../platform/logger.js';
import { defineModule, type KomtruModule } from '../../platform/module.js';
import type { Actor, CompanyMembership } from '../../platform/http/principal.js';
import type { Request } from 'express';
import { createActorResolver } from './http/middleware.js';
import { authRoutes } from './http/routes/auth.routes.js';
import { createTokenSigner, type TokenSigner } from './infrastructure/jwt/access-token.js';
import { createEpochCache, type EpochCache } from './infrastructure/redis/epoch-cache.js';

export * from './infrastructure/postgres/schema/index.js';

export { SESSION_TTLS, sessionExpiry, slidingIdleExpiry } from './domain/session/ttl.js';
export { issueRefreshToken, refreshTokenHash } from './domain/session/refresh-token.js';
export {
  createTokenSigner,
  type AccessTokenClaims,
  type TokenSigner,
} from './infrastructure/jwt/access-token.js';
export { createEpochCache, type EpochCache } from './infrastructure/redis/epoch-cache.js';
export { resolvePrincipal, type PrincipalDeps } from './services/principal.service.js';
export { bearerToken, createActorResolver } from './http/middleware.js';
export {
  applyKillSwitch,
  bumpSessionsEpoch,
  createSession,
  refreshSession,
  revokeAllSessions,
  revokeSessionFamily,
  type CreateSessionInput,
  type IssuedSession,
  type RefreshOutcome,
  type SessionDeps,
} from './services/session.service.js';

export interface IdentityAuthOptions {
  db: Db;
  redis: Redis;
  config: AppConfig;
  logger: Logger;
  /** T-086's `logistics_company_members` lookup. Absent means nobody has a membership yet. */
  companyMembership?: (db: Db, userId: string) => Promise<CompanyMembership | null>;
}

export interface IdentityAuth {
  /** What `mountRoutes` takes as `resolveActor`: the platform's only way to learn who is calling. */
  resolveActor: (req: Request) => Promise<Actor>;
  signer: TokenSigner;
  epochs: EpochCache;
  routes: KomtruModule['routes'];
}

/**
 * Builds identity's half of authentication. The API process calls this once at boot: `createTokenSigner`
 * throws here, naming the variable, rather than at the first login if the key is missing or malformed.
 */
export function createIdentityAuth(options: IdentityAuthOptions): IdentityAuth {
  const { db, redis, config, logger } = options;
  const signer = createTokenSigner(config);
  const epochs = createEpochCache(redis, config.identity.epochCacheTtlSeconds, logger);
  const principalDeps = {
    db,
    signer,
    epochs,
    logger,
    ...(options.companyMembership ? { companyMembership: options.companyMembership } : {}),
  };

  return {
    signer,
    epochs,
    resolveActor: createActorResolver(principalDeps),
    routes: authRoutes({ db, signer, epochs, logger }),
  };
}

/**
 * The registry entry. Its routes are supplied by the process that built `createIdentityAuth`, so the
 * module object itself holds no state and no connections.
 */
export const identityModule = (auth: IdentityAuth): KomtruModule =>
  defineModule({ name: 'identity', routes: auth.routes, resolveActor: auth.resolveActor });
