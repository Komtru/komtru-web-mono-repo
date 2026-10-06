// The identity module's public surface: the schema other modules read, the session service they
// call, and the actor resolver the API process hands to `mountRoutes`. Other modules may import
// these and nothing else from here; the komtru/module-boundaries rule makes this the only way in.
import type { Redis } from 'ioredis';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/index.js';
import type { Logger } from '../../platform/logger.js';
import { defineModule, type KomtruModule, type SeedableModule } from '../../platform/module.js';
import type { Actor, CompanyMembership } from '../../platform/http/principal.js';
import type { Request } from 'express';
import { createHmacHasher } from '../../platform/crypto/hmac.js';
import { argon2Hasher } from './domain/credential/hashing.js';
import { resolveTermsVersions } from './domain/terms.js';
import { createActorResolver } from './http/middleware.js';
import { authRoutes } from './http/routes/auth.routes.js';
import { registrationRoutes } from './http/routes/registration.routes.js';
import type { AccountDeps } from './services/auth.service.js';
import { usernameRoutes } from './http/username.controller.js';
import { createTokenSigner, type TokenSigner } from './infrastructure/jwt/access-token.js';
import { createEpochCache, type EpochCache } from './infrastructure/redis/epoch-cache.js';
import { seedIdentityCatalogue } from './infrastructure/postgres/seed.js';

export * from './infrastructure/postgres/schema/index.js';
export * from './domain/events.js';
export * from './domain/rbac/catalog.js';
export * from './domain/username/policy.js';
export * from './domain/username/reserved.js';
export * from './domain/username/skeleton.js';
export * from './domain/username/suggest.js';
export * from './domain/terms.js';
export {
  AUDIT_ACTIONS,
  writeAudit,
  type AuditActorType,
  type AuditInput,
  type AuditOutcome,
} from './services/audit.service.js';
export * from './services/username.service.js';
export { seedIdentityCatalogue } from './infrastructure/postgres/seed.js';

export { SESSION_TTLS, sessionExpiry, slidingIdleExpiry } from './domain/session/ttl.js';
export { USABLE_STATUSES, sessionUsableUnder } from './domain/session/status.js';
export { issueRefreshToken, refreshTokenHash } from './domain/session/refresh-token.js';
export {
  createTokenSigner,
  type AccessTokenClaims,
  type TokenSigner,
} from './infrastructure/jwt/access-token.js';
export { createEpochCache, type EpochCache } from './infrastructure/redis/epoch-cache.js';
export * from './domain/credential/hashing.js';
export * from './domain/credential/policy.js';
export * from './domain/credential/lockout.js';
export { checkPasswordBreached, type BreachDeps, type BreachResult } from './domain/credential/breach.js';
export * from './domain/otp/challenge.js';
export * from './domain/registration.js';
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
 * Builds identity's half of authentication, and every route the module serves. The API process calls
 * this once at boot: `createTokenSigner` throws here, naming the variable, rather than at the first
 * login if the key is missing or malformed.
 *
 * The username routes (T-033) are built here too, against the same pool. They used to close over a
 * module-level holder filled in by `start()`, because `routes` is read when the registry mounts and
 * the pool did not exist that early; a builder that is handed the pool removes the holder and the
 * "used before start" failure mode with it.
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

  // §S6 and §S9's pepper. Fails here, naming the variable, rather than at the first registration:
  // an HMAC under an empty key is not an HMAC, and a process that boots without this one cannot
  // issue a single OTP.
  if (!config.identity.hmacPepper) {
    throw new Error('IDENTITY_HMAC_PEPPER is required to build the identity module');
  }

  const account: AccountDeps & { db: Db } = {
    db,
    signer,
    epochs,
    logger,
    hasher: argon2Hasher,
    otpHasher: createHmacHasher(config.identity.hmacPepper),
    breach: { enabled: config.identity.breachCheckEnabled, logger },
    terms: resolveTermsVersions(config.terms),
    mirrorPhoneOtpToEmail: config.identity.mirrorPhoneOtpToEmail,
  };

  return {
    signer,
    epochs,
    resolveActor: createActorResolver(principalDeps),
    routes: [
      ...authRoutes({ db, signer, epochs, logger }),
      ...registrationRoutes(account),
      ...usernameRoutes({ db }),
    ],
  };
}

/**
 * The RBAC catalogue and the reserved namespace: reference data, not schema, reconciled from code on
 * every `pnpm db:migrate` rather than frozen into a migration (seed.ts).
 *
 * Exported separately from the module because the seed runner has only a database — building the
 * whole module would demand a Redis connection and a signing key to insert a list of permissions.
 * Both the module below and the seed registry use this one value, so they cannot drift.
 */
export const identitySeed: SeedableModule = {
  name: 'identity',
  seed: async (db) => void (await seedIdentityCatalogue(db)),
};

/**
 * The registry entry. Its routes are supplied by the process that built `createIdentityAuth`, so the
 * module object itself holds no state and no connections.
 */
export const identityModule = (auth: IdentityAuth): KomtruModule =>
  defineModule({
    ...identitySeed,
    routes: auth.routes,
    resolveActor: auth.resolveActor,
  });
