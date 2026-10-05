import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/env.js';
import { testRedisUrl } from '../support/db-urls.js';

const minimal = {
  POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
  REDIS_URL: testRedisUrl(),
};

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

  it('logs JSON in production by default', () => {
    expect(loadConfig({ ...minimal, NODE_ENV: 'production' }).log.format).toBe('json');
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
