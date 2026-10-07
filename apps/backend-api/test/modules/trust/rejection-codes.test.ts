// The acceptance criterion "rejection reasons structured for BVR1 and VF1", end to end: what a job
// WRITES into `verification_requests.rejection_reason` must be a code `describeRejection` knows.
//
// This file exists because the first version of the module did not do that. The jobs wrote
// `result.failureReason` — the provider's own prose — into the column, and `describeRejection` is
// deliberately forgiving on the way out, so every single rejection fell through to
// `NEEDS_HUMAN_REVIEW`. The user-visible consequence is the exact opposite of the truth: VF1 told a
// seller with a blurry photo that "someone on our team is checking this by hand" when nobody was,
// and offered them a WAIT_FOR_REVIEW where the screen's own copy offers a resubmit.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { IdentityCheckResult, LivenessCheckResult } from '../../../src/modules/trust/domain/provider.js';
import { describeRejection, isRejectionCode } from '../../../src/modules/trust/domain/rejection.js';
import { runIdentityCheck } from '../../../src/modules/trust/jobs/run-identity-check.job.js';
import { runLivenessCheck } from '../../../src/modules/trust/jobs/run-liveness-check.job.js';
import type { TrustJobDeps } from '../../../src/modules/trust/jobs/deps.js';
import {
  recordingGateway,
  requestRow,
  scriptedAdapter,
  silentLogger,
  stubStore,
  testEncryption,
  testHasher,
} from './support.js';
import type { StubStoreOptions } from './support.js';

const encryption = testEncryption();

const jobDeps = (store: TrustJobDeps['store'], adapter: TrustJobDeps['adapter']): TrustJobDeps => ({
  store,
  adapter,
  hasher: testHasher(),
  encryption,
  gateway: recordingGateway(),
  logger: silentLogger(),
});

const runIdentity = async (result: IdentityCheckResult, options: StubStoreOptions = {}) => {
  const request = requestRow({ verificationType: 'NIN' });
  const store = stubStore({ ...options, request });
  const sealed = encryption.encrypt(
    JSON.stringify({ identifier: '12345678904', firstName: 'Ada', lastName: 'Obi' }),
  );
  await runIdentityCheck(jobDeps(store, scriptedAdapter({ identity: result })), {
    requestId: request.id,
    sealed,
  });
  return store;
};

describe('what a rejected identity check stores', () => {
  it('stores the adapter’s failureCode, not the provider’s sentence', async () => {
    const store = await runIdentity({
      verdict: 'FAILED',
      providerReference: 'fake_nin_abc',
      failureReason: 'name_similarity below threshold (0.41)',
      failureCode: 'ID_NAME_MISMATCH',
    });

    const written = store.identityOutcomes[0]?.rejectionReason;
    expect(written).toBe('ID_NAME_MISMATCH');
    expect(describeRejection(written ?? '')).toMatchObject({
      code: 'ID_NAME_MISMATCH',
      surface: 'VF1',
      outcome: 'FAILED',
      remedy: 'RESUBMIT',
      identityLevelAffected: true,
    });
  });

  it('never persists the provider’s own words, which are vendor-speak and not ours to show', async () => {
    const store = await runIdentity({
      verdict: 'FAILED',
      providerReference: 'fake_nin_abc',
      failureReason: 'NO_RECORD_FOUND',
      failureCode: 'ID_NOT_FOUND',
    });
    expect(store.identityOutcomes[0]?.rejectionReason).not.toContain('NO_RECORD_FOUND');
  });

  it('falls back to a code when the adapter cannot say why, rather than to free text', async () => {
    const store = await runIdentity({
      verdict: 'FAILED',
      providerReference: 'fake_nin_abc',
      failureReason: 'something the vendor made up',
    });
    const written = store.identityOutcomes[0]?.rejectionReason ?? '';
    expect(isRejectionCode(written)).toBe(true);
    expect(written).toBe('ID_NOT_FOUND');
  });

  it('parks a LOW_CONFIDENCE result under the review code, which is what that status means', async () => {
    const store = await runIdentity({ verdict: 'LOW_CONFIDENCE', providerReference: 'fake_nin_abc' });
    expect(store.identityOutcomes[0]).toMatchObject({
      requestStatus: 'MANUAL_REVIEW',
      rejectionReason: 'NEEDS_HUMAN_REVIEW',
    });
  });

  it('writes no reason at all on a pass', async () => {
    const store = await runIdentity({ verdict: 'PASSED', providerReference: 'fake_nin_abc' });
    expect(store.identityOutcomes[0]?.rejectionReason).toBeUndefined();
  });
});

describe('what a rejected liveness check stores', () => {
  const runLiveness = async (result: LivenessCheckResult, options: StubStoreOptions = {}) => {
    const request = requestRow({ verificationType: 'LIVENESS', selfieStorageRef: randomUUID() });
    const store = stubStore({
      facts: { identifierVerified: true, latestVerifiedIdentifier: 'NIN' },
      ...options,
      request,
    });
    await runLivenessCheck(jobDeps(store, scriptedAdapter({ liveness: result })), {
      requestId: request.id,
    });
    return store;
  };

  it('stores a code VF1 can turn into the “upload a clearer photo” remedy', async () => {
    const store = await runLiveness({
      verdict: 'FAILED',
      providerReference: 'fake_liveness_abc',
      matchScore: 12,
      livenessPassed: false,
      failureReason: 'spoof_detected',
    });
    const written = store.livenessOutcomes[0]?.rejectionReason ?? '';
    expect(written).toBe('LIVENESS_FAILED');
    expect(describeRejection(written).remedy).toBe('RESUBMIT_WITH_CLEARER_PHOTO');
  });

  /**
   * The refusal with exactly one cause, and the one VF1's copy must NOT blame on lighting: telling
   * this user to retake the photo sends them to retry something that cannot pass until the earlier
   * step is done.
   */
  it('uses the dedicated code when there is no identifier to match against', async () => {
    const store = await runLiveness(
      { verdict: 'PASSED', providerReference: 'x', matchScore: 90, livenessPassed: true },
      { facts: { identifierVerified: false } },
    );
    expect(store.livenessOutcomes[0]).toMatchObject({
      requestStatus: 'REJECTED',
      rejectionReason: 'LIVENESS_NO_IDENTIFIER',
    });
    expect(describeRejection('LIVENESS_NO_IDENTIFIER').why).toMatch(/no verified NIN or BVN/i);
  });
});
