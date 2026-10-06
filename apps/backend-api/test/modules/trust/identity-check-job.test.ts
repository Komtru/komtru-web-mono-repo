// The job that calls a provider and writes what it said. Against a hand-written adapter and a
// hand-written store, because the questions that matter here — what we do with each verdict, what we
// do when the number is already somebody's, what we record when the call fails — have nothing to do
// with SQL.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { IdentityCheckResult } from '../../../src/modules/trust/domain/provider.js';
import { runIdentityCheck } from '../../../src/modules/trust/jobs/run-identity-check.job.js';
import type { TrustJobDeps } from '../../../src/modules/trust/jobs/deps.js';
import {
  containing,
  recordingGateway,
  requestRow,
  scriptedAdapter,
  silentLogger,
  stubStore,
  testEncryption,
  testHasher,
  uniqueViolation,
} from './support.js';
import type { StubStoreOptions } from './support.js';

const encryption = testEncryption();
const RAW_NIN = '12345678904';

const passed: IdentityCheckResult = {
  verdict: 'PASSED',
  providerReference: 'fake_nin_abc',
  nameMatchScore: 93.5,
};

interface RunOptions extends StubStoreOptions {
  result?: IdentityCheckResult | Error;
  identifier?: string;
}

const run = async (options: RunOptions = {}) => {
  const request = options.request ?? requestRow();
  const store = stubStore({ ...options, request });
  const adapter = scriptedAdapter({ identity: options.result ?? passed });
  const gateway = recordingGateway();
  const deps: TrustJobDeps = {
    store,
    adapter,
    hasher: testHasher(),
    encryption,
    gateway,
    logger: silentLogger(),
  };
  const sealed = encryption.encrypt(
    JSON.stringify({ identifier: options.identifier ?? RAW_NIN, firstName: 'Ada', lastName: 'Obi' }),
  );
  const error = await runIdentityCheck(deps, { requestId: request.id, sealed }).catch(
    (caught: unknown) => caught,
  );
  return { store, adapter, request, error, emitted: gateway.emitted };
};

describe('runIdentityCheck', () => {
  it('writes a provider-call row for a verdict of no-match, and calls the CALL a success', async () => {
    // `succeeded` is about the call, not the answer. A provider that replies "no record matched"
    // answered, and will bill for it; recording that as a failure would make the error rate that
    // drives `verification.provider_degraded` track rejected users instead of a broken vendor.
    const { store } = await run({
      result: { verdict: 'FAILED', providerReference: 'r', failureReason: 'no match' },
    });
    expect(store.providerCalls).toHaveLength(1);
    expect(store.providerCalls[0]).toMatchObject({ provider: 'FAKE', callType: 'NIN', succeeded: true });
  });

  it('records a provider-call row when the adapter throws, then rethrows for the queue to retry', async () => {
    const { store, error } = await run({ result: new Error('boom') });
    expect(error).toBeInstanceOf(Error);
    expect(store.providerCalls[0]).toMatchObject({ succeeded: false, errorKind: 'exception' });
  });

  it('measures the call rather than leaving the cost log blind', async () => {
    const { store } = await run();
    expect(store.providerCalls[0]?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('stores the mask, the hash and the reference — and never the number', async () => {
    const { store } = await run();
    expect(store.identityOutcomes[0]).toMatchObject({
      masked: '*******8904',
      providerReference: 'fake_nin_abc',
      markVerified: true,
    });
    expect(JSON.stringify(store.identityOutcomes)).not.toContain(RAW_NIN);
  });

  it('routes a NIN already verified by another active user to MANUAL_REVIEW, not a 500 and not a rejection', async () => {
    const firstUserId = randomUUID();
    const { store, error } = await run({
      applyIdentityOutcomeThrows: uniqueViolation('nin_verifications_hash_active_unique'),
      identifierOwner: firstUserId,
    });
    expect(error).toBeUndefined();
    expect(store.duplicates).toHaveLength(1);
    expect(store.duplicates[0]).toMatchObject({ firstUserId });
    expect(store.grants).toHaveLength(0);
  });

  it('treats the submitter’s OWN already-verified number as a success, not a fraud signal', async () => {
    // The review finding this exists for: without the owner check, a user re-submitting their own
    // verified NIN hits the partial unique index against their own row, gets parked in MANUAL_REVIEW
    // — which holds their one in-flight slot and which the sweep deliberately skips — and has a
    // duplicate-identity event published about them to Risk. There is no way out of that without SQL.
    const request = requestRow();
    const { store, error, emitted } = await run({
      request,
      applyIdentityOutcomeThrows: uniqueViolation('nin_verifications_hash_active_unique'),
      identifierOwner: request.userId,
    });

    expect(error).toBeUndefined();
    expect(store.duplicates).toHaveLength(0);
    expect(store.settledAlreadyVerified).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ payload: containing({ status: 'APPROVED' }) });
  });

  it('still re-evaluates the level on a self-duplicate, so a stalled user is not stuck', async () => {
    const request = requestRow();
    const { store } = await run({
      request,
      applyIdentityOutcomeThrows: uniqueViolation('nin_verifications_hash_active_unique'),
      identifierOwner: request.userId,
      facts: { identifierVerified: true, livenessPassed: true },
    });
    expect(store.grants[0]).toMatchObject({ toLevel: 2 });
  });

  it('rethrows a violation that is not the duplicate rule', async () => {
    const { error } = await run({ applyIdentityOutcomeThrows: uniqueViolation('some_other_index') });
    expect(error).toBeInstanceOf(Error);
  });

  it('leaves verified_at unset on a LOW_CONFIDENCE outcome, so the index does not claim the number', async () => {
    const { store } = await run({
      result: { verdict: 'LOW_CONFIDENCE', providerReference: 'r', nameMatchScore: 61 },
    });
    expect(store.identityOutcomes[0]).toMatchObject({
      markVerified: false,
      requestStatus: 'MANUAL_REVIEW',
    });
  });

  it('rejects terminally on FAILED, carrying the provider’s reason', async () => {
    const { store } = await run({
      result: { verdict: 'FAILED', providerReference: 'r', failureReason: 'no record matched' },
    });
    expect(store.identityOutcomes[0]).toMatchObject({
      requestStatus: 'REJECTED',
      rejectionReason: 'no record matched',
    });
  });

  it('leaves a PENDING verdict pending, and grants nothing', async () => {
    const { store } = await run({ result: { verdict: 'PENDING', providerReference: 'r' } });
    expect(store.identityOutcomes[0]?.requestStatus).toBe('PROVIDER_PENDING');
    expect(store.grants).toHaveLength(0);
  });

  it('grants nothing on a pass until liveness has also passed', async () => {
    const { store } = await run({ facts: { identifierVerified: true, livenessPassed: false } });
    expect(store.grants).toHaveLength(0);
  });

  it('grants level 2 once the identifier and liveness are both in', async () => {
    const { store } = await run({ facts: { identifierVerified: true, livenessPassed: true } });
    expect(store.grants[0]).toMatchObject({ toLevel: 2, actorType: 'PROVIDER_AUTO', provider: 'FAKE' });
  });

  it('does nothing for a request that already reached a terminal status', async () => {
    const { store, adapter } = await run({ request: requestRow({ status: 'REJECTED' }) });
    expect(adapter.calls).toBe(0);
    expect(store.identityOutcomes).toHaveLength(0);
  });

  it('stops when the sweep decided the request while the provider was being called', async () => {
    // The window the review found: claimRequest reads the status once, the provider call takes
    // seconds, and an unguarded UPDATE would then overwrite EXPIRED with APPROVED and grant level 2
    // — on a request the sweep had already closed. The store refuses the write; the job must not
    // then go on to grant anything or tell the user they passed.
    const { store, emitted } = await run({
      facts: { identifierVerified: true, livenessPassed: true },
      outcomeApplied: false,
    });
    expect(store.grants).toHaveLength(0);
    expect(emitted).toEqual([]);
  });

  it('does nothing for a request that is gone', async () => {
    const request = requestRow();
    const store = stubStore({ request: undefined });
    const deps: TrustJobDeps = {
      store,
      adapter: scriptedAdapter({ identity: passed }),
      hasher: testHasher(),
      encryption,
      gateway: recordingGateway(),
      logger: silentLogger(),
    };
    await runIdentityCheck(deps, { requestId: request.id, sealed: encryption.encrypt('{}') });
    expect(store.providerCalls).toHaveLength(0);
  });

  it('pushes the terminal outcome to the submitting user and nobody else', async () => {
    const { emitted, request } = await run();
    expect(emitted).toEqual([
      {
        userId: request.userId,
        event: 'verification:updated',
        payload: containing({ requestId: request.id, status: 'APPROVED' }),
      },
    ]);
  });

  it('pushes nothing for a verdict that is not an answer yet', async () => {
    const { emitted } = await run({ result: { verdict: 'PENDING', providerReference: 'r' } });
    expect(emitted).toEqual([]);
  });

  it('never puts the number in the socket payload either', async () => {
    const { emitted } = await run();
    expect(JSON.stringify(emitted)).not.toContain(RAW_NIN);
  });
});
