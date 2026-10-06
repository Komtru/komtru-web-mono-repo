import { describe, expect, it } from 'vitest';
import { CLOUDINARY_PREFIXES, ConfigError, loadConfig } from '../../src/config/env.js';
import { testRedisUrl } from '../support/db-urls.js';
import { productionProcessEnv } from '../support/production-env.js';

const minimal = {
  POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
  REDIS_URL: testRedisUrl(),
};

/**
 * The smallest environment a production process boots in.
 *
 * It is not `{ ...minimal, NODE_ENV: 'production' }` any more: T-050 made the KYC provider flag a
 * deliberate choice in production, because its default is a deterministic fake that would otherwise
 * grant identity levels nobody attested. The production-only variables come from the shared fixture
 * rather than being listed here, so the next rule added to `loadConfig` reaches this suite without
 * anybody remembering to carry it over.
 */
const production = { ...minimal, ...productionProcessEnv() };

const failure = (env: Record<string, string>): ConfigError => {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected loadConfig to throw');
};

describe('loadConfig', () => {
  it('applies defaults to a minimal environment', () => {
    const config = loadConfig(minimal);
    expect(config).toMatchObject({
      nodeEnv: 'development',
      port: 7813,
      log: { level: 'info', format: 'pretty' },
      http: { allowedOrigins: [], trustProxyHops: 0 },
      postgres: { url: minimal.POSTGRES_URL, ssl: false, poolMax: 10 },
      redis: { url: minimal.REDIS_URL },
      sentry: { environment: 'development' },
    });
    expect(config.sentry.dsn).toBeUndefined();
  });

  it('exposes the Paystack keys only when they are set', () => {
    expect(loadConfig(minimal).paystack).toEqual({});
    // An empty value in .env means "not set" — it must never become an empty-string secret.
    expect(loadConfig({ ...minimal, PAYSTACK_SECRET_KEY: '' }).paystack).toEqual({});
    expect(
      loadConfig({ ...minimal, PAYSTACK_SECRET_KEY: 'sk-test-value', PAYSTACK_PUBLIC_KEY: 'pk-test-value' })
        .paystack,
    ).toEqual({ secretKey: 'sk-test-value', publicKey: 'pk-test-value' });
  });

  it('exposes the direct URL and runtime role password only when set', () => {
    expect(loadConfig(minimal).postgres).not.toHaveProperty('appPassword');
    const config = loadConfig({
      ...minimal,
      POSTGRES_DIRECT_URL: 'postgresql://komtru:komtru@localhost:55432/komtru_v2_dev',
      POSTGRES_APP_PASSWORD: 'komtru_app',
    });
    expect(config.postgres).toMatchObject({
      directUrl: 'postgresql://komtru:komtru@localhost:55432/komtru_v2_dev',
      appPassword: 'komtru_app',
    });
  });

  it('schedules in Africa/Lagos unless told otherwise, and rejects an unknown timezone', () => {
    expect(loadConfig(minimal).scheduler.timezone).toBe('Africa/Lagos');
    expect(loadConfig({ ...minimal, SCHEDULER_TIMEZONE: 'UTC' }).scheduler.timezone).toBe('UTC');
    expect(failure({ ...minimal, SCHEDULER_TIMEZONE: 'Mars/Olympus' }).invalid).toEqual([
      'SCHEDULER_TIMEZONE',
    ]);
  });

  it('accepts a 32-byte hex encryption key and rejects anything else', () => {
    const key = 'a'.repeat(64);
    expect(loadConfig({ ...minimal, ENCRYPTION_KEY: key }).crypto.encryptionKey).toBe(key);
    expect(loadConfig(minimal).crypto).not.toHaveProperty('encryptionKey');
    expect(failure({ ...minimal, ENCRYPTION_KEY: 'a'.repeat(63) }).invalid).toEqual(['ENCRYPTION_KEY']);
    expect(failure({ ...minimal, ENCRYPTION_KEY: `${'a'.repeat(62)}zz` }).invalid).toEqual([
      'ENCRYPTION_KEY',
    ]);
  });

  it('reads the identity token settings', () => {
    const config = loadConfig({
      ...minimal,
      IDENTITY_SIGNING_KEY: 'a'.repeat(64),
      IDENTITY_SIGNING_KEY_ID: 'k1',
      IDENTITY_ACCESS_TOKEN_TTL_SECONDS: '600',
      IDENTITY_TOKEN_ISSUER: 'https://api.komtru.com',
      IDENTITY_TOKEN_AUDIENCE: 'komtru',
      IDENTITY_EPOCH_CACHE_TTL_SECONDS: '10',
    });
    expect(config.identity).toEqual({
      signingKey: 'a'.repeat(64),
      signingKeyId: 'k1',
      accessTokenTtlSeconds: 600,
      tokenIssuer: 'https://api.komtru.com',
      tokenAudience: 'komtru',
      epochCacheTtlSeconds: 10,
      breachCheckEnabled: false,
      mirrorPhoneOtpToEmail: false,
      staffRequireMfa: true,
      webauthn: { rpId: 'localhost', rpName: 'Komtru', origins: [] },
    });
  });

  it('defaults the identity token settings and names an invalid signing key', () => {
    expect(loadConfig(minimal).identity).toEqual({
      accessTokenTtlSeconds: 600,
      tokenIssuer: 'https://api.komtru.com',
      tokenAudience: 'komtru',
      epochCacheTtlSeconds: 10,
      breachCheckEnabled: false,
      mirrorPhoneOtpToEmail: false,
      staffRequireMfa: true,
      webauthn: { rpId: 'localhost', rpName: 'Komtru', origins: [] },
    });
    expect(failure({ ...minimal, IDENTITY_SIGNING_KEY: 'nothex' }).invalid).toEqual(['IDENTITY_SIGNING_KEY']);
    expect(failure({ ...minimal, IDENTITY_ACCESS_TOKEN_TTL_SECONDS: '1' }).invalid).toEqual([
      'IDENTITY_ACCESS_TOKEN_TTL_SECONDS',
    ]);
  });

  it('logs JSON in production by default', () => {
    expect(loadConfig(production).log.format).toBe('json');
  });

  it('splits and trims the allowed origins', () => {
    const config = loadConfig({ ...minimal, ALLOWED_ORIGINS: 'http://a.test, http://b.test ,' });
    expect(config.http.allowedOrigins).toEqual(['http://a.test', 'http://b.test']);
  });

  it('treats an empty SENTRY_DSN as unset', () => {
    expect(loadConfig({ ...minimal, SENTRY_DSN: '' }).sentry.dsn).toBeUndefined();
  });

  it('names missing variables without revealing any value', () => {
    const secret = 'super-secret-value-123';
    const error = failure({ JWT_SECRET: secret });
    expect(error.missing).toEqual(expect.arrayContaining(['POSTGRES_URL', 'REDIS_URL']));
    expect(error.message).toContain('POSTGRES_URL');
    expect(error.message).not.toContain(secret);
  });

  it('lists invalid variables by name only', () => {
    const error = failure({ ...minimal, PORT: 'abc', POSTGRES_SSL: 'maybe' });
    expect(error.invalid).toEqual(expect.arrayContaining(['PORT', 'POSTGRES_SSL']));
    expect(error.message).not.toContain('abc');
    expect(error.message).not.toContain('maybe');
  });
});

describe('loadConfig: notifications', () => {
  const fcmServiceAccount = JSON.stringify({
    client_email: 'notify@komtru.iam.gserviceaccount.com',
    // Deliberately not PEM-shaped: loadConfig only needs a non-empty string, and a literal that
    // looks like a key trips the repository's secret scanner.
    private_key: 'not-a-real-key',
    token_uri: 'https://oauth2.googleapis.com/token',
  });

  it('applies the M11 defaults', () => {
    expect(loadConfig(minimal).notify).toMatchObject({
      defaultLocale: 'en-NG',
      maxAttempts: 5,
      retryBaseDelayMs: 2000,
      rateLimitWindowMinutes: 60,
      rateLimitMaxPerWindow: 20,
    });
  });

  it('defaults SMS and push to dry run outside production', () => {
    expect(loadConfig({ ...minimal, NODE_ENV: 'development' }).notify).toMatchObject({
      smsDryRun: true,
      pushDryRun: true,
    });
  });

  it('sends for real in production unless told otherwise', () => {
    expect(loadConfig(production).notify).toMatchObject({
      smsDryRun: false,
      pushDryRun: false,
    });
  });

  it('lets production keep a channel in dry run', () => {
    const config = loadConfig({ ...production, NOTIFY_SMS_DRY_RUN: 'true' });
    expect(config.notify).toMatchObject({ smsDryRun: true, pushDryRun: false });
  });

  it('leaves the mailjet block absent until every credential is set', () => {
    expect(loadConfig({ ...minimal, MAILJET_API_KEY: 'k' }).notify.mailjet).toBeUndefined();
  });

  it('builds the mailjet block once every credential is set', () => {
    const config = loadConfig({
      ...minimal,
      MAILJET_API_KEY: 'k',
      MAILJET_API_SECRET: 's',
      MAILJET_FROM_EMAIL: 'no-reply@komtru.com',
      MAILJET_SANDBOX: 'true',
    });
    expect(config.notify.mailjet).toEqual({
      apiKey: 'k',
      apiSecret: 's',
      fromEmail: 'no-reply@komtru.com',
      fromName: 'Komtru',
      sandbox: true,
    });
  });

  it('leaves the termii block absent without a base URL', () => {
    expect(
      loadConfig({ ...minimal, TERMII_API_KEY: 'k', TERMII_SENDER_ID: 'Komtru' }).notify.termii,
    ).toBeUndefined();
  });

  it('builds the fcm block from the service account', () => {
    const config = loadConfig({
      ...minimal,
      FCM_PROJECT_ID: 'komtru',
      FCM_SERVICE_ACCOUNT_JSON: fcmServiceAccount,
    });
    expect(config.notify.fcm).toMatchObject({
      projectId: 'komtru',
      clientEmail: 'notify@komtru.iam.gserviceaccount.com',
      tokenUri: 'https://oauth2.googleapis.com/token',
    });
  });

  it('rejects a malformed FCM service account by name, without its contents', () => {
    const error = failure({ ...minimal, FCM_SERVICE_ACCOUNT_JSON: '{"private_key": "leaked"}' });
    expect(error.invalid).toContain('FCM_SERVICE_ACCOUNT_JSON');
    expect(error.message).not.toContain('leaked');
  });

  it('rejects a non-positive attempt cap', () => {
    expect(failure({ ...minimal, NOTIFY_MAX_ATTEMPTS: '0' }).invalid).toContain('NOTIFY_MAX_ATTEMPTS');
  });

  it('defaults the redis namespace to the shared production one', () => {
    const { redis } = loadConfig(minimal);
    expect(redis.keyPrefix).toBe('komtru:');
    expect(redis.queuePrefix).toBe('komtru:bull');
  });

  it('takes a namespace per run, so two runs cannot see each other', () => {
    const { redis } = loadConfig({
      ...minimal,
      REDIS_KEY_PREFIX: 'komtru_t3:',
      REDIS_QUEUE_PREFIX: 'komtru_t3:bull',
    });
    expect(redis.keyPrefix).toBe('komtru_t3:');
    expect(redis.queuePrefix).toBe('komtru_t3:bull');
  });

  // `FOO=` means "not set" everywhere in this loader, so an empty namespace falls back to the
  // production one rather than to no prefix at all. That is the safe direction: keys land where
  // they land today. Nothing can reach Redis with an empty prefix.
  it('treats an empty namespace as unset, not as no prefix', () => {
    const { redis } = loadConfig({ ...minimal, REDIS_KEY_PREFIX: '', REDIS_QUEUE_PREFIX: '' });
    expect(redis.keyPrefix).toBe('komtru:');
    expect(redis.queuePrefix).toBe('komtru:bull');
  });
});

describe('loadConfig: files', () => {
  it('reads a Cloudinary account from its credential prefix', () => {
    const config = loadConfig({
      ...minimal,
      CLOUDINARY_TRADE_1_CLOUD_NAME: 'komtru-trade-1',
      CLOUDINARY_TRADE_1_API_KEY: '111111111111111',
      CLOUDINARY_TRADE_1_API_SECRET: 'trade-one-placeholder',
    });
    expect(config.files.accounts.CLOUDINARY_TRADE_1).toEqual({
      cloudName: 'komtru-trade-1',
      apiKey: '111111111111111',
      apiSecret: 'trade-one-placeholder',
    });
  });

  it('omits a Cloudinary prefix that is missing any one of its three values', () => {
    // A half-configured account would sign uploads with an empty secret, which Cloudinary rejects
    // with a 401 that names nothing. Absent is the only honest answer.
    const config = loadConfig({
      ...minimal,
      CLOUDINARY_CHAT_CLOUD_NAME: 'komtru-chat',
      CLOUDINARY_CHAT_API_KEY: '222222222222222',
    });
    expect(config.files.accounts.CLOUDINARY_CHAT).toBeUndefined();
  });

  it('knows all five credential prefixes M20 D5 names', () => {
    expect(CLOUDINARY_PREFIXES).toEqual([
      'CLOUDINARY_PROFILE',
      'CLOUDINARY_CHAT',
      'CLOUDINARY_TRADE_1',
      'CLOUDINARY_TRADE_2',
      'CLOUDINARY_TRADE_3',
    ]);
  });

  it('defaults the files tuning values to M20 §5', () => {
    const config = loadConfig(minimal);
    expect(config.files.accounts).toEqual({});
    expect(config.files.quota).toEqual({ nearPct: 85, disabledPct: 97 });
    expect(config.files.maxUploadBytes).toBe(10 * 1024 * 1024);
    expect(config.files.uploadTicketTtlMinutes).toBe(30);
    expect(config.files.signedUrlTtlSeconds).toBe(300);
  });

  it('refuses a near-quota threshold at or above the disabled one', () => {
    // Otherwise an account goes straight from ACTIVE to DISABLED and the NEAR_QUOTA warning — the
    // whole point of polling usage rather than waiting for a failed upload — never fires.
    expect(failure({ ...minimal, FILES_QUOTA_NEAR_PCT: '97' }).invalid).toContain('FILES_QUOTA_NEAR_PCT');
  });

  it('compares the resolved thresholds, not only the ones that were set', () => {
    // Lowering just the disabled threshold leaves near at its 85 default, above it, and NEAR_QUOTA
    // becomes unreachable — the early warning silently off, which is the one failure mode the whole
    // polling design exists to prevent.
    expect(failure({ ...minimal, FILES_QUOTA_DISABLED_PCT: '50' }).invalid).toContain('FILES_QUOTA_NEAR_PCT');
  });

  it('accepts a pair an operator lowered together', () => {
    const config = loadConfig({ ...minimal, FILES_QUOTA_NEAR_PCT: '40', FILES_QUOTA_DISABLED_PCT: '50' });
    expect(config.files.quota).toEqual({ nearPct: 40, disabledPct: 50 });
  });
});

describe('the identity and terms variables T-032 adds', () => {
  it('reads them when they are set', () => {
    const config = loadConfig({
      ...minimal,
      IDENTITY_HMAC_PEPPER: 'p'.repeat(32),
      IDENTITY_BREACH_CHECK_ENABLED: 'true',
      IDENTITY_MIRROR_PHONE_OTP_TO_EMAIL: 'true',
      APP_TERMS_VERSION: '2026-09-01',
      APP_PRIVACY_VERSION: '2026-09-02',
    });
    expect(config.identity.hmacPepper).toBe('p'.repeat(32));
    expect(config.identity.breachCheckEnabled).toBe(true);
    expect(config.identity.mirrorPhoneOtpToEmail).toBe(true);
    expect(config.terms).toEqual({ version: '2026-09-01', privacyVersion: '2026-09-02' });
  });

  it('defaults the two flags off and leaves the terms override empty', () => {
    const config = loadConfig(minimal);
    expect(config.identity.hmacPepper).toBeUndefined();
    expect(config.identity.breachCheckEnabled).toBe(false);
    expect(config.identity.mirrorPhoneOtpToEmail).toBe(false);
    // Empty, not defaulted: identity's resolveTermsVersions owns the shipped version.
    expect(config.terms).toEqual({});
  });

  it('refuses a pepper short enough to be brute-forced, naming the variable', () => {
    expect(failure({ ...minimal, IDENTITY_HMAC_PEPPER: 'short' }).message).toContain('IDENTITY_HMAC_PEPPER');
  });

  it('treats an empty pepper as absent rather than as an empty key', () => {
    expect(loadConfig({ ...minimal, IDENTITY_HMAC_PEPPER: '' }).identity.hmacPepper).toBeUndefined();
  });
});

describe('the identity variables T-036 adds', () => {
  it('reads the WebAuthn relying party and the staff MFA switch', () => {
    const config = loadConfig({
      ...minimal,
      WEBAUTHN_RP_ID: 'komtru.com',
      WEBAUTHN_RP_NAME: 'Komtru',
      WEBAUTHN_ORIGINS: 'https://app.komtru.com, https://staff.komtru.com',
      IDENTITY_STAFF_REQUIRE_MFA: 'false',
    });
    expect(config.identity.webauthn).toEqual({
      rpId: 'komtru.com',
      rpName: 'Komtru',
      origins: ['https://app.komtru.com', 'https://staff.komtru.com'],
    });
    expect(config.identity.staffRequireMfa).toBe(false);
  });

  it('defaults the relying party to localhost with no origin', () => {
    expect(loadConfig(minimal).identity.webauthn).toEqual({
      rpId: 'localhost',
      rpName: 'Komtru',
      origins: [],
    });
  });

  /**
   * M1 §S13 makes staff MFA mandatory, so the default has to be the safe one: the variable exists
   * to turn the requirement OFF in a local sandbox, and an operator who forgets to set it must get
   * the rule rather than the exception.
   */
  it('requires staff MFA when the switch is absent', () => {
    expect(loadConfig(minimal).identity.staffRequireMfa).toBe(true);
  });
});
