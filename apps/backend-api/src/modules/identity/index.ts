// The identity module's public surface: the schema other modules read, the session service they
// call, and the actor resolver the API process hands to `mountRoutes`. Other modules may import
// these and nothing else from here; the komtru/module-boundaries rule makes this the only way in.
import type { Redis } from 'ioredis';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/index.js';
import type { Logger } from '../../platform/logger.js';
import { defineModule, type KomtruModule, type SeedableModule } from '../../platform/module.js';
import type { ScheduledJob } from '../../platform/scheduler/registry.js';
import type { Actor, CompanyMembership } from '../../platform/http/principal.js';
import type { Request } from 'express';
import { createHmacHasher } from '../../platform/crypto/hmac.js';
import { createEncryption } from '../../platform/crypto/encryption.js';
import { argon2Hasher } from './domain/credential/hashing.js';
import { resolveTermsVersions } from './domain/terms.js';
import { createActorResolver } from './http/middleware.js';
import { authRoutes } from './http/routes/auth.routes.js';
import { addressRoutes } from './http/routes/address.routes.js';
import { deviceRoutes } from './http/routes/device.routes.js';
import { mfaRoutes } from './http/routes/mfa.routes.js';
import { passwordRoutes } from './http/routes/password.routes.js';
import { staffAuthRoutes } from './http/routes/staff-auth.routes.js';
import { adminRoutes } from './http/routes/admin.routes.js';
import { callerAgent, callerIp } from './http/controllers/request.js';
import { recordRouteDenial } from './services/rbac.service.js';
import { routeLabel } from '../../platform/http/route.js';
import { registrationRoutes } from './http/routes/registration.routes.js';
import type { MfaDeps } from './services/mfa.service.js';
import { createRelyingParty } from './infrastructure/webauthn/relying-party.js';
import { createWebauthnChallengeStore } from './infrastructure/redis/webauthn-challenge.js';
import { usernameRoutes } from './http/username.controller.js';
import { partyRoutes } from './http/routes/party.routes.js';
import type { PartyControllerDeps } from './http/controllers/party.controller.js';
import { expireInvitations } from './services/invitation.service.js';
import { expireStaffInvitations } from './services/staff-invitation.service.js';
import { staffInvitationRoutes } from './http/routes/staff-invitation.routes.js';
import { createLookupBudget } from './infrastructure/redis/lookup-budget.js';
import { createTokenSigner, type TokenSigner } from './infrastructure/jwt/access-token.js';
import { createEpochCache, type EpochCache } from './infrastructure/redis/epoch-cache.js';
import { seedIdentityCatalogue } from './infrastructure/postgres/seed.js';

export * from './infrastructure/postgres/schema/index.js';
export * from './domain/events.js';
export * from './domain/rbac/catalog.js';
export * from './domain/rbac/sod.js';
export { bootstrapSuperAdmins, BootstrapRefused } from './services/bootstrap.service.js';
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
/**
 * T-050's one new export: M6 decides a level, identity performs the write. See the file's header for
 * why this is a call rather than M6 §3 D6's event subscription.
 */
export {
  applyVerificationLevel,
  type ApplyVerificationLevelInput,
  type ApplyVerificationLevelResult,
} from './services/user.service.js';
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
export * from './domain/mfa/policy.js';
export * from './domain/mfa/totp.js';
export * from './domain/mfa/recovery-codes.js';
export {
  activeFactors,
  findOwnFactor,
  holdsLiveAdminRole,
  issueFactorChallenge,
  listFactors,
  removeFactor,
  verifyFactor,
  type FactorRow,
  type FactorView,
  type MfaDeps,
} from './services/mfa.service.js';
export { issueStepUpToken, consumeStepUpToken, requireStepUp } from './services/step-up.service.js';
export { completeMfaLogin, issueMfaToken, type MfaChallengeView } from './services/mfa-login.service.js';
export { createRelyingParty, type RelyingParty } from './infrastructure/webauthn/relying-party.js';
export {
  createWebauthnChallengeStore,
  type WebauthnChallengeStore,
} from './infrastructure/redis/webauthn-challenge.js';
export {
  deviceLabel,
  listDevices,
  registerDevice,
  retireDevice,
  signInLocation,
  trustDevice,
  upsertDevice,
  type DeviceView,
} from './services/device.service.js';
export {
  applyKillSwitch,
  bumpSessionsEpoch,
  createSession,
  refreshSession,
  listSessions,
  revokeAllSessions,
  revokeSession,
  revokeSessionFamily,
  type CreateSessionInput,
  type IssuedSession,
  type RefreshOutcome,
  type SessionDeps,
} from './services/session.service.js';

// T-035. Appended at the end of the block so a parallel ticket's additions do not collide with it.
export * from './domain/capability.js';
// T-042. `hasUsableAddress` is the trade gates' question (T-061); the rest is the saved-address API.
export {
  addressNotFound,
  anonymiseUserAddresses,
  archiveAddress,
  createAddress,
  hasUsableAddress,
  listAddresses,
  makeDefaultAddress,
  updateAddress,
  type AddressDeps,
  type AddressRequestContext,
  type AddressView,
  type CityLookup,
} from './services/address.service.js';
import type { CityLookup } from './services/address.service.js';
export {
  createCapabilityService,
  postgresBuyerFacts,
  type BuyerFacts,
  type BuyerFactsLookup,
  type CapabilityService,
} from './services/capability.service.js';
export * from './domain/party/card.js';
export * from './domain/party/lookup.js';
export * from './domain/invitation.js';
export {
  LOOKUP_WINDOWS,
  NO_LOOKUP_BUDGET,
  createLookupBudget,
  type LookupBudget,
} from './infrastructure/redis/lookup-budget.js';
export {
  assertLookupEligible,
  lookupParty,
  suggestParties,
  type LookupInput,
  type LookupResult,
  type PartyDeps,
  type PartyPorts,
} from './services/party.service.js';
export {
  claimInvitationsForDestination,
  createInvitation,
  expireInvitations,
  previewInvitation,
  resolveInvitationToken,
  type CreateInvitationInput,
  type CreateInvitationResult,
  type InvitationDeps,
  type InvitationPreview,
} from './services/invitation.service.js';

/** 02:05 Africa/Lagos: off-peak, and a trade stuck in PENDING_COUNTERPARTY is freed before the
 * working day starts rather than at the end of it. */
export const PARTY_INVITATIONS_EXPIRE_CRON = '5 2 * * *';
export const PARTY_INVITATIONS_EXPIRE_SCHEDULE = 'identity.party-invitations-expire';
export const STAFF_INVITATIONS_EXPIRE_CRON = '15 2 * * *';
export const STAFF_INVITATIONS_EXPIRE_SCHEDULE = 'identity.staff-invitations-expire';

export interface IdentityAuthOptions {
  db: Db;
  redis: Redis;
  config: AppConfig;
  logger: Logger;
  /** T-086's `logistics_company_members` lookup. Absent means nobody has a membership yet. */
  companyMembership?: (db: Db, userId: string) => Promise<CompanyMembership | null>;
  /**
   * The geo catalog's `getCitiesByIds`, wired by the registry (identity cannot import geo: geo imports
   * identity). Absent means address writes fail loudly rather than skip the city check.
   */
  cities?: CityLookup;
}

export interface IdentityAuth {
  /** What `mountRoutes` takes as `resolveActor`: the platform's only way to learn who is calling. */
  resolveActor: (req: Request) => Promise<Actor>;
  /** Records a STAFF route's scope or permission 403, which no handler ever sees. */
  onAccessDenied: NonNullable<KomtruModule['onAccessDenied']>;
  signer: TokenSigner;
  epochs: EpochCache;
  routes: KomtruModule['routes'];
  schedules: ScheduledJob[];
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
const missingCityLookup: CityLookup = () =>
  Promise.reject(new Error('identity: no city lookup was wired in (IdentityAuthOptions.cities)'));

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

  // §S9's envelope encryption: `party_invitations.destination_enc` (T-035), and TOTP seeds and the
  // recovery-code sheet (T-036). Built here rather than on first use for the same reason as the
  // pepper above — an invitation has to be stored recoverably to be sent, and a process that will
  // serve `/me/mfa/totp/enroll` should say so while it is starting, naming ENCRYPTION_KEY, rather
  // than at somebody's first invitation or first enrolment.
  const encryption = createEncryption(config);

  const account: MfaDeps & { db: Db } = {
    db,
    signer,
    epochs,
    logger,
    hasher: argon2Hasher,
    otpHasher: createHmacHasher(config.identity.hmacPepper),
    breach: { enabled: config.identity.breachCheckEnabled, logger },
    terms: resolveTermsVersions(config.terms),
    mirrorPhoneOtpToEmail: config.identity.mirrorPhoneOtpToEmail,
    encryption,
    // Allowed to throw here, naming its variable, the way the pepper check above does: an empty
    // WebAuthn origin list is not a wildcard, and a process that will serve a passkey ceremony
    // should fail at boot rather than at a user's first enrolment.
    webauthn: createRelyingParty(config, logger),
    webauthnChallenges: createWebauthnChallengeStore(redis, logger),
    staffRequireMfa: config.identity.staffRequireMfa,
  };

  // T-035. `enrich` is deliberately absent: M7's completed-trade count, M5's merchant name and
  // M20's signed avatar URL have no module to come from yet, so every PartyCard carries zero trades,
  // no merchant name and no avatar. See `PartyPorts.enrich` for the rule whoever supplies it must
  // keep.
  const party: PartyControllerDeps = {
    db,
    budget: createLookupBudget({ redis, logger }),
    hasher: account.otpHasher,
    encryption,
    logger,
  };

  return {
    signer,
    epochs,
    resolveActor: createActorResolver(principalDeps),
    onAccessDenied: async ({ route, actor, req, reason }) => {
      const principal = actor.principal;
      if (route.scope !== 'STAFF' || !principal) return;
      const body = (req.body ?? {}) as { reason?: unknown };
      const query = req.query.reason;
      await recordRouteDenial(db, {
        actor: {
          userId: principal.userId,
          roles: principal.roles,
          sessionId: principal.sessionId,
          ip: callerIp(req),
          userAgent: callerAgent(req),
        },
        route: routeLabel(route),
        permission: route.permission,
        reason,
        stated:
          typeof query === 'string'
            ? query
            : typeof body.reason === 'string'
              ? body.reason
              : req.get('x-admin-reason'),
      });
    },
    routes: [
      ...authRoutes({ db, signer, epochs, logger }),
      ...registrationRoutes(account),
      ...passwordRoutes(account),
      ...staffAuthRoutes(account),
      ...adminRoutes({ db, epochs }),
      ...staffInvitationRoutes({ db, hasher: account.otpHasher, encryption, logger }),
      ...usernameRoutes({ db }),
      ...partyRoutes(party),
      ...deviceRoutes({ db, logger }),
      ...addressRoutes({ db, cities: options.cities ?? missingCityLookup }),
      ...mfaRoutes(account),
    ],
    schedules: [
      {
        name: PARTY_INVITATIONS_EXPIRE_SCHEDULE,
        cron: PARTY_INVITATIONS_EXPIRE_CRON,
        description: 'Expires party invitations unclaimed after 14 days (M1 §8.5 step 7).',
        handler: () => expireInvitations(db),
      },
      {
        name: STAFF_INVITATIONS_EXPIRE_SCHEDULE,
        cron: STAFF_INVITATIONS_EXPIRE_CRON,
        description: 'Expires staff invitations unaccepted after 7 days (T-038).',
        handler: () => expireStaffInvitations(db),
      },
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
    schedules: auth.schedules,
    resolveActor: auth.resolveActor,
    onAccessDenied: auth.onAccessDenied,
  });
