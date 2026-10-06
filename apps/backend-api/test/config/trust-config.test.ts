// The feature flag that decides who attests an identity. Its most important case is the one that
// refuses to boot: a fake KYC provider granting real identity levels in production is not a
// misconfiguration anyone should be able to make quietly (owner's decision Q7).
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

describe('trust configuration', () => {
  it('defaults to the fake provider outside production', () => {
    expect(loadConfig(minimal).trust).toMatchObject({ provider: 'FAKE', requestTtlMinutes: 1440 });
  });

  it('refuses to boot a production process on the fake provider', () => {
    const error = failure({ ...minimal, NODE_ENV: 'production' });
    expect(error.message).toMatch(/TRUST_KYC_PROVIDER/);
  });

  it('boots production when a real provider is named', () => {
    const config = loadConfig({
      ...minimal,
      NODE_ENV: 'production',
      TRUST_KYC_PROVIDER: 'DOJAH',
      DOJAH_APP_ID: 'a',
      DOJAH_SECRET_KEY: 's',
      DOJAH_BASE_URL: 'https://api.dojah.io',
    });
    expect(config.trust).toMatchObject({
      provider: 'DOJAH',
      dojah: { appId: 'a', secretKey: 's', baseUrl: 'https://api.dojah.io' },
    });
  });

  it('refuses a provider with no adapter behind it', () => {
    expect(failure({ ...minimal, TRUST_KYC_PROVIDER: 'PREMBLY' }).message).toMatch(/TRUST_KYC_PROVIDER/);
  });

  it('leaves dojah absent when its credentials are only partly supplied', () => {
    const config = loadConfig({ ...minimal, DOJAH_APP_ID: 'a' });
    expect(config.trust.dojah).toBeUndefined();
  });

  it('bounds the request TTL, so an expiry sweep always has something to sweep', () => {
    expect(failure({ ...minimal, TRUST_REQUEST_TTL_MINUTES: '1' }).message).toMatch(
      /TRUST_REQUEST_TTL_MINUTES/,
    );
  });
});
