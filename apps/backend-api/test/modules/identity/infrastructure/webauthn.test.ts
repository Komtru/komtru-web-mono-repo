// The relying-party wrapper and the challenge store. The wrapper's job is to bind the configuration
// once and to turn the library's THROWS into verdicts; both are testable without a browser.
import { describe, expect, it, vi } from 'vitest';
import { createRelyingParty } from '../../../../src/modules/identity/infrastructure/webauthn/relying-party.js';
import {
  WEBAUTHN_CHALLENGE_TTL_SECONDS,
  createWebauthnChallengeStore,
} from '../../../../src/modules/identity/infrastructure/redis/webauthn-challenge.js';
import type { Redis } from 'ioredis';
import { testConfig, testLogger } from '../support.js';

const config = (overrides: Record<string, string> = {}) =>
  testConfig({
    WEBAUTHN_RP_ID: 'komtru.com',
    WEBAUTHN_RP_NAME: 'Komtru',
    WEBAUTHN_ORIGINS: 'https://app.komtru.com,https://staff.komtru.com',
    ...overrides,
  });

describe('createRelyingParty', () => {
  /**
   * An empty origin list is not a wildcard; it is a configuration mistake. Failing at boot, naming
   * the variable, is the house rule for every other credential this module needs.
   */
  it('refuses to build with no origin, naming the variable', () => {
    const noOrigins = testConfig({ WEBAUTHN_RP_ID: 'komtru.com' });
    expect(() => createRelyingParty(noOrigins, testLogger)).toThrow('WEBAUTHN_ORIGINS');
  });

  it('builds registration options for the configured relying party', async () => {
    const rp = createRelyingParty(config(), testLogger);
    const options = await rp.registrationOptions({
      userId: '11111111-1111-4111-8111-111111111111',
      userName: 'janedoe',
      displayName: 'Jane Doe',
      exclude: [{ id: 'Y3JlZC1vbmU', transports: ['internal'] }],
    });

    expect((options.rp as { id: string; name: string }).id).toBe('komtru.com');
    expect((options.rp as { id: string; name: string }).name).toBe('Komtru');
    expect(Buffer.from(options.challenge as string, 'base64url').length).toBeGreaterThanOrEqual(32);
    expect(options.excludeCredentials).toEqual([
      { id: 'Y3JlZC1vbmU', transports: ['internal'], type: 'public-key' },
    ]);
    // Second factor, not passwordless: demanding the authenticator's own user verification would
    // make a security key with no PIN impossible to enrol.
    expect((options.authenticatorSelection as { userVerification: string }).userVerification).toBe(
      'preferred',
    );
  });

  /** The user id the authenticator files the credential under, never an address (§S12). */
  it('uses the opaque user id as the WebAuthn user handle', async () => {
    const rp = createRelyingParty(config(), testLogger);
    const options = await rp.registrationOptions({
      userId: '11111111-1111-4111-8111-111111111111',
      userName: 'janedoe',
      displayName: 'Jane Doe',
      exclude: [],
    });
    const user = options.user as { id: string; name: string };
    expect(Buffer.from(user.id, 'base64url').toString('utf8')).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('builds authentication options restricted to the credentials it was given', async () => {
    const rp = createRelyingParty(config(), testLogger);
    const options = await rp.authenticationOptions({
      allow: [{ id: 'Y3JlZC1vbmU', transports: ['hybrid'] }],
    });
    expect(options.rpId).toBe('komtru.com');
    expect(options.allowCredentials).toEqual([
      { id: 'Y3JlZC1vbmU', transports: ['hybrid'], type: 'public-key' },
    ]);
  });

  /**
   * The library throws for every refusal it knows. A service that let those through would answer
   * 500 to a user whose browser prompt simply timed out, so the wrapper is where they become `null`.
   */
  it('answers null rather than throwing for a response that does not verify', async () => {
    const rp = createRelyingParty(config(), testLogger);
    expect(
      await rp.verifyRegistration({ response: { not: 'a credential' }, expectedChallenge: 'nope' }),
    ).toBeNull();
  });

  it('answers a false verdict rather than throwing for an assertion that does not verify', async () => {
    const rp = createRelyingParty(config(), testLogger);
    expect(
      await rp.verifyAuthentication({
        response: { not: 'an assertion' },
        expectedChallenge: 'nope',
        credential: { id: 'Y3JlZC1vbmU', publicKey: Buffer.alloc(32), counter: 0, transports: [] },
      }),
    ).toEqual({ verified: false, newCounter: 0 });
  });
});

describe('createWebauthnChallengeStore', () => {
  const fakeRedis = () => {
    const store = new Map<string, string>();
    return {
      store,
      redis: {
        set: vi.fn((key: string, value: string) => {
          store.set(key, value);
          return Promise.resolve('OK');
        }),
        getdel: vi.fn((key: string) => {
          const value = store.get(key) ?? null;
          store.delete(key);
          return Promise.resolve(value);
        }),
      } as unknown as Redis,
    };
  };

  it('stores a challenge under the ceremony key with a TTL', async () => {
    const { redis } = fakeRedis();
    const challenges = createWebauthnChallengeStore(redis, testLogger);
    await challenges.put('session-1', 'the-challenge');
    expect(redis.set).toHaveBeenCalledWith(
      'mfa:webauthn:session-1',
      'the-challenge',
      'EX',
      WEBAUTHN_CHALLENGE_TTL_SECONDS,
    );
  });

  /** Single use is the anti-replay property a WebAuthn challenge exists for. */
  it('hands a challenge back exactly once', async () => {
    const { redis } = fakeRedis();
    const challenges = createWebauthnChallengeStore(redis, testLogger);
    await challenges.put('session-1', 'the-challenge');

    expect(await challenges.take('session-1')).toBe('the-challenge');
    expect(await challenges.take('session-1')).toBeNull();
  });

  it('answers null for a ceremony nobody began', async () => {
    const { redis } = fakeRedis();
    expect(await createWebauthnChallengeStore(redis, testLogger).take('never')).toBeNull();
  });

  /** Failing CLOSED: a ceremony that proceeded without its challenge would verify nothing. */
  it('answers null when Redis is unreachable rather than letting the ceremony continue', async () => {
    const redis = {
      getdel: vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    } as unknown as Redis;
    expect(await createWebauthnChallengeStore(redis, testLogger).take('session-1')).toBeNull();
  });
});
