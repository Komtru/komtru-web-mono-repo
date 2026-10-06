// Building the registry takes a running process's connections (T-031 made `createModules` a builder
// so identity can construct a token signer and an epoch cache before it exists). A test that only
// asks "is this module registered, and what does it declare?" has no process and needs none: nothing
// in the builder dials Redis or queries Postgres, it only stores the handles for later. So these are
// the cheapest deps that let it run — with a real signing key, because `createTokenSigner` refuses a
// missing one by design.
import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { loadConfig, type AppConfig } from '../../src/config/env.js';
import type { Db } from '../../src/db/index.js';
import { createModules, type ProcessDeps } from '../../src/modules/index.js';
import { createLogger } from '../../src/platform/logger.js';
import type { KomtruModule } from '../../src/platform/module.js';
import { testRedisEnv, testRedisUrl } from './db-urls.js';

export const registryConfig = (overrides: Record<string, string> = {}): AppConfig =>
  loadConfig({
    LOG_LEVEL: 'silent',
    POSTGRES_URL: 'postgresql://x@localhost/x',
    REDIS_URL: testRedisUrl(),
    ...testRedisEnv(),
    IDENTITY_SIGNING_KEY: randomBytes(32).toString('hex'),
    IDENTITY_SIGNING_KEY_ID: 'test-key',
    // Identity refuses to build without it (T-032): an HMAC under an empty key is not an HMAC.
    IDENTITY_HMAC_PEPPER: 'p'.repeat(32),
    // Identity refuses to build without these, and each fails at boot naming its own variable
    // rather than at a user's first attempt: an invitation destination must be stored recoverably
    // to be sent (T-035), TOTP seeds and the recovery-code blob are envelope-encrypted (T-036), and
    // an empty WebAuthn origin list is not a wildcard.
    ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    WEBAUTHN_ORIGINS: 'https://app.komtru.test',
    ...overrides,
  });

export const stubProcessDeps = (overrides: Record<string, string> = {}): ProcessDeps => {
  const config = registryConfig(overrides);
  // Never used: every call site below reads declarations off the built modules.
  return { db: {} as Db, redis: {} as Redis, config, logger: createLogger(config) };
};

/** The registry as a process would build it, for tests that assert over its contents. */
export const testModules = (overrides: Record<string, string> = {}): KomtruModule[] =>
  createModules(stubProcessDeps(overrides));

export const testModule = (name: string, overrides: Record<string, string> = {}): KomtruModule => {
  const found = testModules(overrides).find((module) => module.name === name);
  if (!found) throw new Error(`testModule(): no module named "${name}" in the registry`);
  return found;
};
