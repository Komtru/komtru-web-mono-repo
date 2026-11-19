// Opening a browser liveness session.
//
// The property worth protecting here is that the reference is ours. It is handed to the browser and
// echoed back inside a webhook, which makes it the one field of a delivery an attacker chooses — so
// it must be unguessable and it must not be anything the caller already knows.
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../src/platform/errors.js';
import { newSessionReference } from '../../../src/modules/trust/http/controllers.js';
import { startLivenessSession } from '../../../src/modules/trust/services/verification.service.js';
import { requestRow, silentLogger, testEncryption, testHasher } from './support.js';

const youverify = { publicMerchantKey: 'pk_live_abc', baseUrl: 'https://api.sandbox.youverify.co' };

const deps = (all: Record<string, unknown> = {}) => {
  // `store` is merged into the stub below, so it must not also land in the final spread — doing
  // both replaces the merged stub with the partial override and every method disappears.
  const { store: storeOverride, ...overrides } = all;
  const created: Record<string, unknown>[] = [];
  const pending: unknown[] = [];
  const store = {
    findSubject: () =>
      Promise.resolve({ userId: 'u1', status: 'ACTIVE', verificationLevel: 'CONTACT_VERIFIED' }),
    identityFacts: () => Promise.resolve({ identifierVerified: true, livenessPassed: false }),
    countAttempts: () => Promise.resolve(0),
    createRequest: (input: Record<string, unknown>) => {
      created.push(input);
      return Promise.resolve(requestRow({ verificationType: 'LIVENESS', ...input }));
    },
    markProviderPending: (...args: unknown[]) => {
      pending.push(args);
      return Promise.resolve(true);
    },
    ...((storeOverride as Record<string, unknown>) ?? {}),
  };
  return {
    created,
    pending,
    deps: {
      store: store as never,
      hasher: testHasher(),
      encryption: testEncryption(),
      requestTtlMinutes: 60,
      logger: silentLogger(),
      youverify,
      mintReference: () => 'minted-reference',
      ...overrides,
    } as never,
  };
};

describe('startLivenessSession', () => {
  it('returns what the SDK needs and the minted reference', async () => {
    const { deps: d } = deps();
    const session = await startLivenessSession(d, { userId: 'u1' });
    expect(session.publicMerchantKey).toBe('pk_live_abc');
    expect(session.reference).toBe('minted-reference');
  });

  it('never reuses the request id as the reference', async () => {
    const { deps: d } = deps();
    const session = await startLivenessSession(d, { userId: 'u1' });
    expect(session.reference).not.toBe(session.requestId);
  });

  it('stores the reference on the request, which is what the webhook looks up', async () => {
    const { deps: d, created } = deps();
    await startLivenessSession(d, { userId: 'u1' });
    expect(created[0]?.providerSessionRef).toBe('minted-reference');
    expect(created[0]?.verificationType).toBe('LIVENESS');
  });

  it('parks the request at PROVIDER_PENDING, since no job of ours will move it', async () => {
    const { deps: d, pending } = deps();
    await startLivenessSession(d, { userId: 'u1' });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toContain('YOUVERIFY');
  });

  it('reads sandbox from the base URL rather than taking it on trust', async () => {
    const sandbox = await startLivenessSession(deps().deps, { userId: 'u1' });
    expect(sandbox.sandbox).toBe(true);
    const live = await startLivenessSession(
      deps({ youverify: { ...youverify, baseUrl: 'https://api.youverify.co' } }).deps,
      { userId: 'u1' },
    );
    expect(live.sandbox).toBe(false);
  });

  it('refuses before minting anything when no identifier is verified (M6 §4)', async () => {
    const { deps: d, created } = deps({
      store: { identityFacts: () => Promise.resolve({ identifierVerified: false, livenessPassed: false }) },
    });
    await expect(startLivenessSession(d, { userId: 'u1' })).rejects.toBeInstanceOf(ApiError);
    // Nothing was created: a user must not be sent into a camera flow whose result is discardable.
    expect(created).toHaveLength(0);
  });

  it('answers 503 with a provider code when no provider is configured', async () => {
    const { deps: d } = deps({ youverify: undefined });
    await expect(startLivenessSession(d, { userId: 'u1' })).rejects.toMatchObject({
      status: 503,
      code: 'VERIFICATION_PROVIDER_UNAVAILABLE',
    });
  });

  it('refuses a user whose selfie check is already done', async () => {
    const { deps: d, created } = deps({
      store: {
        identityFacts: () => Promise.resolve({ identifierVerified: true, livenessPassed: true }),
      },
    });
    await expect(startLivenessSession(d, { userId: 'u1' })).rejects.toMatchObject({ status: 409 });
    expect(created).toHaveLength(0);
  });

  /** The production mint, not a re-implementation of it — the previous version of this test
   *  asserted only that Node's CSPRNG returns two different values, which pinned nothing. */
  it('mints an unguessable reference', () => {
    expect(newSessionReference()).not.toBe(newSessionReference());
    expect(newSessionReference()).toHaveLength(43);
    expect(newSessionReference()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
