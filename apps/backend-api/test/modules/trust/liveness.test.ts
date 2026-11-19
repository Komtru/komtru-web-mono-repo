// Liveness: the half of level 2 that proves a person is behind the number. Two halves tested here —
// what the submission refuses, and what the job does with the provider's answer.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { LivenessCheckResult } from '../../../src/modules/trust/domain/provider.js';
import { runLivenessCheck } from '../../../src/modules/trust/jobs/run-liveness-check.job.js';
import { submitLivenessCheck } from '../../../src/modules/trust/services/verification.service.js';
import type { TrustJobDeps } from '../../../src/modules/trust/jobs/deps.js';
import type { SelfieFile } from '../../../src/modules/trust/infrastructure/postgres/store.js';
import {
  containing,
  recordingGateway,
  requestRow,
  scriptedAdapter,
  silentLogger,
  stubStore,
  testEncryption,
  testHasher,
} from './support.js';

const USER = randomUUID();
const FILE = randomUUID();

const selfie = (overrides: Partial<SelfieFile> = {}): SelfieFile => ({
  id: FILE,
  uploaderUserId: USER,
  category: 'KYC_DOCUMENT',
  ...overrides,
});

const submitDeps = (store = stubStore()) => ({
  store,
  hasher: testHasher(),
  encryption: testEncryption(),
  requestTtlMinutes: 60,
  allowNameOverride: true,
  logger: silentLogger(),
});

describe('submitLivenessCheck', () => {
  it('refuses a selfie uploaded by someone else, and one that does not exist, identically', async () => {
    const notMine = stubStore({ selfie: selfie({ uploaderUserId: randomUUID() }) });
    const missing = stubStore({ selfie: undefined });
    for (const store of [notMine, missing]) {
      await expect(
        submitLivenessCheck(submitDeps(store), { userId: USER, selfieFileId: FILE }),
      ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    }
  });

  it('refuses a file that is not a KYC document', async () => {
    const store = stubStore({ selfie: selfie({ category: 'CHAT_ATTACHMENT' }) });
    await expect(
      submitLivenessCheck(submitDeps(store), { userId: USER, selfieFileId: FILE }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('creates no request when the file check fails, so nothing is ever enqueued', async () => {
    const store = stubStore({ selfie: undefined });
    await submitLivenessCheck(submitDeps(store), { userId: USER, selfieFileId: FILE }).catch(() => {});
    expect(store.requests).toHaveLength(0);
  });

  it('refuses liveness before any identifier has passed, naming the step that comes first', async () => {
    const store = stubStore({ selfie: selfie(), facts: { identifierVerified: false } });
    await expect(
      submitLivenessCheck(submitDeps(store), { userId: USER, selfieFileId: FILE }),
    ).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
  });

  it('accepts a selfie once an identifier is verified, and records the file reference', async () => {
    const store = stubStore({
      selfie: selfie(),
      facts: { identifierVerified: true, latestVerifiedIdentifier: 'NIN' },
    });
    await expect(
      submitLivenessCheck(submitDeps(store), { userId: USER, selfieFileId: FILE }),
    ).resolves.toMatchObject({ status: 'SUBMITTED' });
    expect(store.requests[0]).toMatchObject({ verificationType: 'LIVENESS', selfieStorageRef: FILE });
  });
});

const passedLiveness: LivenessCheckResult = {
  verdict: 'PASSED',
  providerReference: 'fake_liveness_abc',
  matchScore: 91,
  livenessPassed: true,
};

const runJob = async (
  options: {
    result?: LivenessCheckResult | Error;
    latest?: 'NIN' | 'BVN';
    identifierVerified?: boolean;
  } = {},
) => {
  const request = requestRow({ userId: USER, verificationType: 'LIVENESS', selfieStorageRef: FILE });
  // The real store derives `identifierVerified` from whether there IS a latest verified identifier,
  // so the stub must not offer one while claiming there is none — that pairing cannot occur.
  const identifierVerified = options.identifierVerified ?? true;
  const store = stubStore({
    request,
    facts: {
      identifierVerified,
      ...(identifierVerified ? { latestVerifiedIdentifier: options.latest ?? 'NIN' } : {}),
      livenessPassed: options.result === undefined || options.result === passedLiveness,
    },
  });
  const gateway = recordingGateway();
  const deps: TrustJobDeps = {
    store,
    adapter: scriptedAdapter({ liveness: options.result ?? passedLiveness }),
    hasher: testHasher(),
    encryption: testEncryption(),
    gateway,
    logger: silentLogger(),
  };
  const error = await runLivenessCheck(deps, { requestId: request.id }).catch((e: unknown) => e);
  return { store, error, emitted: gateway.emitted };
};

describe('runLivenessCheck', () => {
  it('matches the selfie against the most recently verified identifier', async () => {
    const { store } = await runJob({ latest: 'BVN' });
    expect(store.livenessOutcomes[0]).toMatchObject({ matchedAgainst: 'BVN', livenessPassed: true });
  });

  it('grants level 2 when liveness passes and an identifier is already verified', async () => {
    const { store } = await runJob();
    expect(store.grants[0]).toMatchObject({ toLevel: 2 });
  });

  it('grants nothing when the provider says the selfie was not live', async () => {
    const { store } = await runJob({
      result: {
        verdict: 'FAILED',
        providerReference: 'r',
        matchScore: 12,
        livenessPassed: false,
        failureReason: 'not a live capture',
      },
    });
    expect(store.livenessOutcomes[0]?.requestStatus).toBe('REJECTED');
    expect(store.grants).toHaveLength(0);
  });

  it('refuses to grant on a PASSED verdict whose own liveness flag says otherwise', async () => {
    const { store } = await runJob({
      result: { verdict: 'PASSED', providerReference: 'r', matchScore: 90, livenessPassed: false },
    });
    expect(store.livenessOutcomes[0]?.requestStatus).toBe('REJECTED');
    expect(store.grants).toHaveLength(0);
  });

  it('rejects rather than calling a provider when the identifier it would match against is gone', async () => {
    const { store, error } = await runJob({ identifierVerified: false });
    expect(error).toBeUndefined();
    // No provider call: there is nothing to match against, so paying for one would be waste.
    expect(store.providerCalls).toHaveLength(0);
    // But the refusal IS recorded, with its reason — a request that reaches REJECTED with no row
    // behind it is one nobody can explain to the user who asks why.
    expect(store.livenessOutcomes[0]).toMatchObject({
      requestStatus: 'REJECTED',
      livenessPassed: false,
      providerReference: 'not-called',
    });
    expect(store.grants).toHaveLength(0);
  });

  it('logs the provider call and rethrows when the adapter throws', async () => {
    const { store, error } = await runJob({ result: new Error('boom') });
    expect(error).toBeInstanceOf(Error);
    expect(store.providerCalls[0]).toMatchObject({ callType: 'LIVENESS', succeeded: false });
  });

  it('pushes the outcome to the submitting user', async () => {
    const { emitted } = await runJob();
    expect(emitted).toEqual([
      {
        userId: USER,
        event: 'verification:updated',
        payload: containing({ status: 'APPROVED' }),
      },
    ]);
  });
});
