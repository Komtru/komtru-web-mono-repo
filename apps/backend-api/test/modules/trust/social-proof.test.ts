// The Instagram/X challenge: the claim, the re-check, and the lookup job.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  generateChallengeCode,
  isValidHandle,
  normaliseHandle,
  SOCIAL_CHALLENGE_TTL_MS,
} from '../../../src/modules/trust/domain/social-proof.js';
import {
  claimSocialHandle,
  listSocialProof,
  requestSocialProofCheck,
} from '../../../src/modules/trust/services/socialProof.service.js';
import { runSocialProofCheck } from '../../../src/modules/trust/jobs/run-social-proof-check.job.js';
import { createFakeSocialClient } from '../../../src/modules/trust/infrastructure/providers/fake-social.client.js';
import {
  recordingGateway,
  scriptedSocialAdapter,
  silentLogger,
  socialClaimRow,
  stubStore,
  uniqueViolation,
} from './support.js';

const deps = (options: Parameters<typeof stubStore>[0] = {}) => {
  const store = stubStore(options);
  return { store, deps: { store, logger: silentLogger() } };
};

describe('normaliseHandle', () => {
  it('strips the @ and the case, so one person’s two spellings are one handle', () => {
    expect(normaliseHandle('  @TechEdge_NG ')).toBe('techedge_ng');
  });
});

describe('isValidHandle', () => {
  it('refuses what cannot exist on either platform', () => {
    expect(isValidHandle('techedge_ng')).toBe(true);
    expect(isValidHandle('instagram.com/techedge')).toBe(false);
    expect(isValidHandle('tech edge')).toBe(false);
    expect(isValidHandle('')).toBe(false);
  });
});

describe('generateChallengeCode', () => {
  it('is prefixed, so a seller pasting it into a bio is showing something deliberate', () => {
    expect(generateChallengeCode()).toMatch(/^KOMTRU-[ACDEFGHJKLMNPQRTUVWXY2346789]{8}$/);
  });

  it('avoids the characters nobody can retype off a screen', () => {
    // The random part only: the `KOMTRU-` prefix is fixed, deliberate branding rather than something
    // anyone has to transcribe character by character, and it contains an O.
    const codes = Array.from({ length: 200 }, () => generateChallengeCode().slice('KOMTRU-'.length)).join('');
    expect(codes).not.toMatch(/[01OIS5]/);
  });

  it('does not repeat itself, so a third party cannot pre-publish somebody else’s code', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateChallengeCode()));
    expect(codes.size).toBe(500);
  });
});

describe('claimSocialHandle', () => {
  it('normalises the handle and returns a code the user can publish', async () => {
    const { store, deps: d } = deps();
    const view = await claimSocialHandle(d, {
      userId: randomUUID(),
      platform: 'INSTAGRAM',
      handle: '@TechEdge_NG',
    });
    expect(store.socialClaimsCreated[0]?.handle).toBe('techedge_ng');
    expect(view.challengeCode).toMatch(/^KOMTRU-/);
    expect(view.verified).toBe(false);
    expect(new Date(view.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses a URL rather than spending a lookup on it', async () => {
    const { deps: d } = deps();
    await expect(
      claimSocialHandle(d, { userId: randomUUID(), platform: 'X', handle: 'x.com/techedge' }),
    ).rejects.toMatchObject({ status: 422, code: 'VALIDATION_FAILED' });
  });

  /** Two sellers wearing a verified `@techedge_ng` badge is worse than no badge at all. */
  it('refuses a handle already proved on another account, without saying whose', async () => {
    const { deps: d } = deps({
      createSocialProofClaimThrows: uniqueViolation('social_proof_claims_platform_handle'),
    });
    const error = await claimSocialHandle(d, {
      userId: randomUUID(),
      platform: 'INSTAGRAM',
      handle: 'techedge_ng',
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(JSON.stringify(error)).not.toMatch(/user|account id/i);
  });
});

describe('requestSocialProofCheck', () => {
  const claimOf = (overrides = {}) => socialClaimRow({ ...overrides });

  it('returns a job rather than looking the profile up on the request path', async () => {
    const claim = claimOf();
    const { deps: d } = deps({
      socialClaim: claim,
      subject: {
        userId: claim.userId,
        status: 'ACTIVE',
        verificationLevel: 'CONTACT_VERIFIED',
        firstName: null,
        lastName: null,
      },
    });
    const result = await requestSocialProofCheck(d, { userId: claim.userId, claimId: claim.id });
    expect(result.job).toEqual({ claimId: claim.id });
  });

  it('answers 404 for somebody else’s claim, exactly as for a missing one', async () => {
    const claim = claimOf();
    const { deps: d } = deps({ socialClaim: claim });
    await expect(
      requestSocialProofCheck(d, { userId: randomUUID(), claimId: claim.id }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses an expired challenge with a code the client can act on', async () => {
    const claim = claimOf({ createdAt: new Date(Date.now() - SOCIAL_CHALLENGE_TTL_MS - 1000) });
    const { deps: d } = deps({ socialClaim: claim });
    await expect(
      requestSocialProofCheck(d, { userId: claim.userId, claimId: claim.id }),
    ).rejects.toMatchObject({ status: 409, code: 'CHALLENGE_EXPIRED' });
  });

  /**
   * `RATE_LIMITED`, not a second 429 code. It is already the platform's, already carries
   * `retryAfter`, and already means "you did this too recently".
   */
  it('throttles a re-check with the platform’s own 429 and a retryAfter', async () => {
    const claim = claimOf({ lastCheckedAt: new Date(Date.now() - 1000) });
    const { deps: d } = deps({ socialClaim: claim });
    const error = await requestSocialProofCheck(d, {
      userId: claim.userId,
      claimId: claim.id,
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect((error as { extensions?: { retryAfter?: number } }).extensions?.retryAfter).toBeGreaterThan(0);
  });

  it('has nothing to do for a claim already verified', async () => {
    const claim = claimOf({ verified: true, verifiedAt: new Date() });
    const { deps: d } = deps({ socialClaim: claim });
    await expect(
      requestSocialProofCheck(d, { userId: claim.userId, claimId: claim.id }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('listSocialProof', () => {
  it('returns a real page, not the whole table with a page shape around it', async () => {
    const userId = randomUUID();
    const claims = Array.from({ length: 5 }, (_, i) =>
      socialClaimRow({ userId, handle: `handle${String(i)}` }),
    );
    const { deps: d } = deps({ socialClaims: claims });
    const page = await listSocialProof(d, { userId, page: 2, limit: 2 });
    expect(page).toMatchObject({ page: 2, limit: 2, total: 5 });
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.handle).toBe('handle2');
  });
});

describe('runSocialProofCheck', () => {
  const run = async (
    lookup: Parameters<typeof scriptedSocialAdapter>[0],
    options: Parameters<typeof stubStore>[0] = {},
  ) => {
    const claim = options.socialClaim ?? socialClaimRow();
    const store = stubStore({ ...options, socialClaim: claim });
    const gateway = recordingGateway();
    const adapter = scriptedSocialAdapter(lookup);
    const error = await runSocialProofCheck(
      {
        store,
        social: adapter,
        gateway,
        logger: silentLogger(),
      },
      { claimId: claim.id },
    ).catch((caught: unknown) => caught);
    return { store, claim, adapter, emitted: gateway.emitted, error };
  };

  it('verifies the claim when the code is on the profile, and tells the open app', async () => {
    const { store, claim, emitted } = await run({ outcome: 'CODE_PRESENT', foundIn: 'bio' });
    expect(store.socialDecisions[0]).toEqual({ claimId: claim.id, verified: true });
    expect(emitted[0]).toMatchObject({
      userId: claim.userId,
      event: 'social-proof:updated',
      payload: { claimId: claim.id, verified: true },
    });
  });

  /**
   * `last_checked_at` has to move on a failed lookup too — it is what rate-limits the re-check, and
   * a failure that left it untouched would be a free retry loop against a third party's servers.
   */
  it('records the check even when the code was not there', async () => {
    const { store, claim } = await run({ outcome: 'NO_CODE' });
    expect(store.socialDecisions[0]).toEqual({ claimId: claim.id, verified: false });
  });

  it('distinguishes a handle that does not exist from one with no code up', async () => {
    const missing = await run({ outcome: 'NOT_FOUND' });
    expect(missing.emitted[0]?.payload).toMatchObject({
      verified: false,
      reason: 'SOCIAL_HANDLE_NOT_FOUND',
    });
    const noCode = await run({ outcome: 'NO_CODE' });
    expect(noCode.emitted[0]?.payload).toMatchObject({
      verified: false,
      reason: 'SOCIAL_CHALLENGE_NOT_FOUND',
    });
  });

  it('rethrows an INDETERMINATE lookup so BullMQ retries rather than reporting a failure', async () => {
    const { store, error } = await run({ outcome: 'INDETERMINATE' });
    expect(error).toBeInstanceOf(Error);
    expect(store.socialDecisions).toHaveLength(0);
  });

  it('does nothing for a claim that has gone', async () => {
    // Built directly rather than through `run`, which fills a claim in: the case under test is the
    // store answering `undefined`, which `{ socialClaim: undefined }` cannot express through a `??`.
    const store = stubStore({ socialClaim: undefined });
    const adapter = scriptedSocialAdapter({ outcome: 'CODE_PRESENT' });
    await runSocialProofCheck(
      { store, social: adapter, gateway: recordingGateway(), logger: silentLogger() },
      { claimId: randomUUID() },
    );
    expect(adapter.calls).toBe(0);
    expect(store.socialDecisions).toHaveLength(0);
  });

  it('does not look a verified claim up again', async () => {
    const { adapter } = await run(
      { outcome: 'CODE_PRESENT' },
      { socialClaim: socialClaimRow({ verified: true, verifiedAt: new Date() }) },
    );
    expect(adapter.calls).toBe(0);
  });
});

describe('createFakeSocialClient', () => {
  it('reaches every lookup outcome, so none of the four branches is untested by default', async () => {
    const fake = createFakeSocialClient();
    const outcomes = await Promise.all(
      ['abcz', 'abcy', 'abcx', 'techedge_ng'].map(
        async (handle) =>
          (await fake.lookup({ platform: 'INSTAGRAM', handle, challengeCode: 'KOMTRU-ACDEFGHJ' })).outcome,
      ),
    );
    expect(outcomes).toEqual(['NOT_FOUND', 'NO_CODE', 'INDETERMINATE', 'CODE_PRESENT']);
  });

  it('returns where the code was found and never the profile’s text', async () => {
    const result = await createFakeSocialClient().lookup({
      platform: 'X',
      handle: 'techedge_ng',
      challengeCode: 'KOMTRU-ACDEFGHJ',
    });
    expect(result).toEqual({ outcome: 'CODE_PRESENT', foundIn: 'bio' });
  });
});
