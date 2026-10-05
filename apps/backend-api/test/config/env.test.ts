import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/env.js';

const minimal = {
  POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
  REDIS_URL: 'redis://localhost:56379',
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
