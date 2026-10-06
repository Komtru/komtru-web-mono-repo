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
import { createHmacHasher } from '../../../src/platform/crypto/hmac.js';
import { createTokenSigner } from '../../../src/modules/identity/infrastructure/jwt/access-token.js';
import { createEpochCache } from '../../../src/modules/identity/infrastructure/redis/epoch-cache.js';
import { createLogger } from '../../../src/platform/logger.js';
import { createRedis } from '../../../src/platform/redis/connections.js';
import { generatePublicId } from '../../../src/platform/identifiers.js';
import { testRedisUrl } from '../../support/db-urls.js';

export const testConfig = (overrides: Record<string, string> = {}): AppConfig =>
  loadConfig({
    LOG_LEVEL: 'silent',
    POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
    REDIS_URL: testRedisUrl(),
    IDENTITY_SIGNING_KEY: randomBytes(32).toString('hex'),
    IDENTITY_SIGNING_KEY_ID: 'test-key',
    IDENTITY_HMAC_PEPPER: 'p'.repeat(32),
    ...overrides,
  });

export const testLogger = createLogger(testConfig());

/** The same client the app gets, so keys carry the `komtru:` prefix they will carry in production. */
export const createTestRedis = (): Redis => createRedis(testRedisUrl());

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

/**
 * `AccountDeps` for a test that only inspects route DECLARATIONS — the schemas, the scopes, the
 * rate-limit keys. Nothing here is ever called: `assertRouteInvariants` reads the definitions, it
 * does not run the handlers.
 */
export const stubAccountDeps = (): RegistrationControllerDeps => {
  const config = testConfig();
  return {
    db: null as unknown as Db,
    signer: createTokenSigner(config),
    epochs: {} as never,
    logger: testLogger,
    hasher: argon2Hasher,
    otpHasher: createHmacHasher('pepper-for-tests-0123456789abcdef'),
    breach: { enabled: false, logger: testLogger },
    terms: resolveTermsVersions(config.terms),
    mirrorPhoneOtpToEmail: false,
  };
};
