// Shared setup for T-031's integration tests: a config with a real signing key, the deps the
// principal and session services take, and a seeded user.
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { loadConfig, type AppConfig } from '../../../src/config/env.js';
import type { Db } from '../../../src/db/index.js';
import {
  argon2Hasher,
  type PasswordHasher,
} from '../../../src/modules/identity/domain/credential/hashing.js';
import { resolveTermsVersions } from '../../../src/modules/identity/domain/terms.js';
import type { RegistrationControllerDeps } from '../../../src/modules/identity/http/controllers/registration.controller.js';
import type { AccountDeps } from '../../../src/modules/identity/services/auth.service.js';
import { createHmacHasher } from '../../../src/platform/crypto/hmac.js';
import { createEncryption } from '../../../src/platform/crypto/encryption.js';
import type { MfaDeps } from '../../../src/modules/identity/services/mfa.service.js';
import type { RelyingParty } from '../../../src/modules/identity/infrastructure/webauthn/relying-party.js';
import type { WebauthnChallengeStore } from '../../../src/modules/identity/infrastructure/redis/webauthn-challenge.js';
import { createTokenSigner } from '../../../src/modules/identity/infrastructure/jwt/access-token.js';
import { createEpochCache } from '../../../src/modules/identity/infrastructure/redis/epoch-cache.js';
import { createLogger } from '../../../src/platform/logger.js';
import { createRedis } from '../../../src/platform/redis/connections.js';
import { generatePublicId } from '../../../src/platform/identifiers.js';
import { testKeyPrefix, testRedisEnv, testRedisUrl } from '../../support/db-urls.js';

export const testConfig = (overrides: Record<string, string> = {}): AppConfig =>
  loadConfig({
    LOG_LEVEL: 'silent',
    POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
    REDIS_URL: testRedisUrl(),
    ...testRedisEnv(),
    IDENTITY_SIGNING_KEY: randomBytes(32).toString('hex'),
    IDENTITY_SIGNING_KEY_ID: 'test-key',
    IDENTITY_HMAC_PEPPER: 'p'.repeat(32),
    // T-036: TOTP seeds and the recovery-code blob are `*_enc` columns (§S9), so the module
    // now refuses to build without a key, the way it already refuses without the pepper.
    ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    // `createRelyingParty` refuses an empty origin list by design — it is not a wildcard — and
    // `createIdentityAuth` builds it eagerly, so every suite that builds the module needs one.
    WEBAUTHN_ORIGINS: 'https://app.komtru.test',
    ...overrides,
  });

export const testLogger = createLogger(testConfig());

/** The same client the app gets, so keys carry the `komtru:` prefix they will carry in production. */
export const createTestRedis = (): Redis => createRedis(testRedisUrl(), { keyPrefix: testKeyPrefix() });

/**
 * Waits for the client to finish connecting.
 *
 * The app's client sets `enableOfflineQueue: false` (T-023), so a command issued while it is still
 * connecting fails outright rather than waiting — which is the same reason health readiness holds an
 * instance out of rotation until `ready`. A test that builds the client and immediately fires a
 * request at a rate-limited route gets one 503 on its FIRST case and passes from then on, which
 * reads as a flaky suite and is actually the harness skipping a step production does not.
 */
export const redisReady = async (redis: Redis): Promise<void> => {
  if (redis.status === 'ready') return;
  await new Promise<void>((resolve) =>
    redis.once('ready', () => {
      resolve();
    }),
  );
};

export const identityInfrastructure = (config: AppConfig, redis: Redis) => ({
  signer: createTokenSigner(config),
  epochs: createEpochCache(redis, config.identity.epochCacheTtlSeconds, testLogger),
});

/** A users row in a given status. Returns its id. */
export async function seedUser(
  pool: pg.Pool,
  { status = 'ACTIVE' }: { status?: string } = {},
): Promise<{ userId: string; publicId: string }> {
  const publicId = generatePublicId();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO identity.users (public_id, status) VALUES ($1, $2) RETURNING id`,
    [publicId, status],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('seedUser(): no row returned');
  return { userId: id, publicId };
}

/** Grants a live staff role carrying the given permissions. Creates the catalogue rows it needs. */
export async function grantRole(
  pool: pg.Pool,
  userId: string,
  roleCode: string,
  permissions: string[],
  { requiresDualApproval = false, approved = true, expiresAt = null as Date | null } = {},
): Promise<void> {
  const { userId: grantorId } = await seedUser(pool);
  const { userId: approverId } = await seedUser(pool);
  await pool.query(
    `INSERT INTO identity.roles (code, name, requires_dual_approval) VALUES ($1, $1, $2)
     ON CONFLICT (code) DO NOTHING`,
    [roleCode, requiresDualApproval],
  );
  for (const permission of permissions) {
    const [domain, action] = permission.split('.');
    await pool.query(
      `INSERT INTO identity.permissions (code, domain, action) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO NOTHING`,
      [permission, domain, action],
    );
    await pool.query(
      `INSERT INTO identity.role_permissions (role_code, permission_code) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [roleCode, permission],
    );
  }
  await pool.query(
    `INSERT INTO identity.admin_role_assignments (user_id, role_code, granted_by, approved_by, reason, expires_at)
     VALUES ($1, $2, $3, $4, 'test', $5)`,
    [userId, roleCode, grantorId, approved ? approverId : null, expiresAt],
  );
}

export const outboxEventTypes = async (pool: pg.Pool): Promise<string[]> => {
  const { rows } = await pool.query<{ event_type: string }>(
    `SELECT event_type FROM platform.outbox ORDER BY occurred_at`,
  );
  return rows.map((row) => row.event_type);
};

/**
 * A `PasswordHasher` that counts its calls and costs nothing.
 *
 * Two jobs. One: proving §S3's structural claim — that `verifyAndRecord` performs exactly one
 * password verification on every path, including the paths with no password to verify — which an
 * argon2 hasher can only hint at through timing. Two: making the §17 enumeration timing suite
 * runnable, by removing the ~50ms that is identical on both paths by construction and leaving the
 * database work, which is where a real difference would hide.
 */
export const countingHasher = (
  options: { matches?: boolean; needsRehash?: boolean } = {},
): PasswordHasher & { calls: () => { hash: number; verify: number; decoy: number } } => {
  const calls = { hash: 0, verify: 0, decoy: 0 };
  return {
    calls: () => ({ ...calls }),
    hash: (plaintext) => {
      calls.hash += 1;
      return Promise.resolve(`$argon2id$v=19$m=19456,t=2,p=1$test$${plaintext}`);
    },
    verify: (plaintext, phcHash) => {
      calls.verify += 1;
      return Promise.resolve(options.matches ?? phcHash.endsWith(`$${plaintext}`));
    },
    needsRehash: () => options.needsRehash ?? false,
    decoy: () => {
      calls.decoy += 1;
      return Promise.resolve(false as const);
    },
  };
};

/** `AccountDeps` a service test can call for real, with argon2 unless a cheap hasher is supplied. */
export const accountDeps = (overrides: Partial<AccountDeps> = {}): AccountDeps => {
  const config = testConfig();
  return {
    signer: createTokenSigner(config),
    epochs: {} as never,
    logger: testLogger,
    hasher: argon2Hasher,
    otpHasher: createHmacHasher('pepper-for-tests-0123456789abcdef'),
    breach: { enabled: false, logger: testLogger },
    terms: resolveTermsVersions(config.terms),
    mirrorPhoneOtpToEmail: false,
    ...overrides,
  };
};

/**
 * `AccountDeps` for a test that only inspects route DECLARATIONS — the schemas, the scopes, the
 * rate-limit keys. Nothing here is ever called: `assertRouteInvariants` reads the definitions, it
 * does not run the handlers.
 */
export const stubAccountDeps = (): RegistrationControllerDeps & MfaDeps => ({
  db: null as unknown as Db,
  ...accountDeps(),
  ...mfaStubs(),
});

// ---------------------------------------------------------------------------
// T-036
// ---------------------------------------------------------------------------

/**
 * A `RelyingParty` that verifies whatever it is handed.
 *
 * WebAuthn assertions cannot be produced without an authenticator, and a test that built one by
 * hand would be testing `@simplewebauthn/server` rather than this module. What the integration
 * tests here are actually about is the ROW work around a verdict — the credential, the factor, the
 * sign counter — so the verdict is supplied and the rest is real.
 */
export const stubRelyingParty = (
  overrides: Partial<RelyingParty> = {},
): RelyingParty & { challenges: string[] } => {
  const challenges: string[] = [];
  let counter = 0;
  return {
    challenges,
    rpName: 'Komtru',
    registrationOptions: (input) => {
      const challenge = `challenge-${challenges.length}`;
      challenges.push(challenge);
      return Promise.resolve({ challenge, excludeCredentials: input.exclude });
    },
    verifyRegistration: () =>
      Promise.resolve({
        credentialId: randomBytes(16),
        publicKey: randomBytes(64),
        counter: 0,
        aaguid: null,
        transports: ['internal'],
        backedUp: true,
      }),
    authenticationOptions: () => {
      const challenge = `challenge-${challenges.length}`;
      challenges.push(challenge);
      return Promise.resolve({ challenge });
    },
    verifyAuthentication: () => {
      counter += 1;
      return Promise.resolve({ verified: true, newCounter: counter });
    },
    ...overrides,
  };
};

/** An in-memory `WebauthnChallengeStore` with the same single-use contract as the Redis one. */
export const memoryChallengeStore = (): WebauthnChallengeStore => {
  const store = new Map<string, string>();
  return {
    put: (key, challenge) => {
      store.set(key, challenge);
      return Promise.resolve();
    },
    take: (key) => {
      const value = store.get(key) ?? null;
      store.delete(key);
      return Promise.resolve(value);
    },
  };
};

/** The three fields `MfaDeps` adds over `AccountDeps`, for a test that only needs the shape. */
export const mfaStubs = (): Pick<
  MfaDeps,
  'encryption' | 'webauthn' | 'webauthnChallenges' | 'staffRequireMfa'
> => ({
  encryption: createEncryption(testConfig()),
  webauthn: stubRelyingParty(),
  webauthnChallenges: memoryChallengeStore(),
  staffRequireMfa: true,
});

export const mfaDeps = (overrides: Partial<MfaDeps> = {}): MfaDeps => ({
  ...accountDeps(),
  ...mfaStubs(),
  ...overrides,
});

/**
 * How many statements a piece of work sends to Postgres.
 *
 * The §17 timing assertion can be satisfied on a fast machine by an implementation that reads the
 * MFA factors BEFORE the rejection and throws the answer away — one extra indexed lookup hides
 * inside 5ms. Counting the statements does not depend on how fast the machine is, which is why the
 * enumeration suite asserts both.
 *
 * It wraps BOTH `pool.query` and the `query` of every client `pool.connect()` hands out, because
 * drizzle takes a client for a transaction and issues everything on that — a counter on the pool
 * alone would read zero for every statement inside `db.transaction(...)`, which is all of them.
 * Both are restored in a `finally`, so a throwing subject does not leave the pool wrapped for the
 * rest of the file.
 */
export async function countStatements(pool: pg.Pool, run: () => Promise<unknown>): Promise<number> {
  const originalQuery = pool.query.bind(pool);
  const originalConnect = pool.connect.bind(pool);
  let count = 0;

  const mutable = pool as unknown as { query: unknown; connect: unknown };
  mutable.query = (...args: unknown[]) => {
    count += 1;
    return (originalQuery as (...a: unknown[]) => unknown)(...args);
  };
  mutable.connect = async (...args: unknown[]) => {
    const client = (await (originalConnect as (...a: unknown[]) => unknown)(...args)) as {
      query: (...a: unknown[]) => unknown;
    };
    const clientQuery = client.query.bind(client);
    client.query = (...args2: unknown[]) => {
      count += 1;
      return clientQuery(...args2);
    };
    return client;
  };

  try {
    await run();
  } finally {
    mutable.query = originalQuery;
    mutable.connect = originalConnect;
  }
  return count;
}
