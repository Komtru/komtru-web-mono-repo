// T-055's two reads and one write on trust: ask for the CAC lookup on behalf of a merchant application,
// and read back what it found. The lookup itself is T-051's job and is not exercised here; what is, is
// that asking never throws for an ordinary refusal (the application decides nothing from it) and that
// the sealed claim is enqueued after the request is committed.
import { describe, expect, it, vi } from 'vitest';
import type { QueueFactory } from '../../../src/platform/queue/factory.js';
import { requestBusinessEvidence } from '../../../src/modules/trust/services/evidence.service.js';
import { requestRow, silentLogger, stubStore, testEncryption, uniqueViolation } from './support.js';

const queues = () => {
  const add = vi.fn(() => Promise.resolve({}));
  const producer = vi.fn(() => ({ add }));
  return { add, producer, factory: { producer } as unknown as QueueFactory };
};

const deps = (store: ReturnType<typeof stubStore>, q: ReturnType<typeof queues>) => ({
  store,
  encryption: testEncryption(),
  requestTtlMinutes: 60,
  logger: silentLogger(),
  queues: q.factory,
});

const identityVerified = { userId: 'u', status: 'ACTIVE', verificationLevel: 'IDENTITY_VERIFIED' } as const;

describe('requestBusinessEvidence', () => {
  it('commits a CAC request and enqueues the sealed claim on the business-check queue', async () => {
    const store = stubStore({ subject: identityVerified });
    const q = queues();
    const result = await requestBusinessEvidence(deps(store, q), { userId: 'u', rcNumber: 'RC123456' });

    expect(result).toMatchObject({ outcome: 'ENQUEUED' });
    expect(store.requests).toHaveLength(1);
    expect(store.requests[0]?.verificationType).toBe('CAC');
    expect(q.producer).toHaveBeenCalledWith('trust.business-check');
    expect(q.add).toHaveBeenCalledTimes(1);
    const [name, job, options] = q.add.mock.calls[0] as unknown as [
      string,
      { sealed: string },
      { jobId: string },
    ];
    expect(name).toBe('check');
    // The RC number is public record, but the claim also carries the officer's name: sealed, always.
    expect(job.sealed).not.toContain('RC123456');
    expect(options.jobId).toBe(store.requests[0]?.id);
  });

  it('does nothing when the business is already verified: no request, no billed call', async () => {
    const store = stubStore({
      subject: identityVerified,
      verifiedBusiness: { id: 'b', registeredBusinessName: 'Techedge Ltd' } as never,
    });
    const q = queues();
    expect(await requestBusinessEvidence(deps(store, q), { userId: 'u', rcNumber: 'RC123456' })).toEqual({
      outcome: 'ALREADY_VERIFIED',
    });
    expect(store.requests).toHaveLength(0);
    expect(q.add).not.toHaveBeenCalled();
  });

  it('does nothing while a CAC check is already in flight', async () => {
    const store = stubStore({
      subject: identityVerified,
      openRequests: [requestRow({ userId: 'u', verificationType: 'CAC', status: 'PROVIDER_PENDING' })],
    });
    const q = queues();
    expect(await requestBusinessEvidence(deps(store, q), { userId: 'u', rcNumber: 'RC123456' })).toEqual({
      outcome: 'IN_FLIGHT',
    });
    expect(q.add).not.toHaveBeenCalled();
  });

  it('reports a lost race on the one-in-flight index as in flight, not as an error', async () => {
    const store = stubStore({
      subject: identityVerified,
      createRequestThrows: uniqueViolation('verification_requests_one_in_flight'),
    });
    expect(
      await requestBusinessEvidence(deps(store, queues()), { userId: 'u', rcNumber: 'RC123456' }),
    ).toEqual({
      outcome: 'IN_FLIGHT',
    });
  });

  it('is blocked, not failed, while the applicant has not verified their own identity', async () => {
    const store = stubStore({
      subject: { userId: 'u', status: 'ACTIVE', verificationLevel: 'CONTACT_VERIFIED' },
    });
    const q = queues();
    expect(await requestBusinessEvidence(deps(store, q), { userId: 'u', rcNumber: 'RC123456' })).toEqual({
      outcome: 'BLOCKED',
      code: 'IDENTITY_VERIFICATION_REQUIRED',
    });
    expect(q.add).not.toHaveBeenCalled();
  });

  it('is blocked on an RC number that does not look like one', async () => {
    const store = stubStore({ subject: identityVerified });
    expect(await requestBusinessEvidence(deps(store, queues()), { userId: 'u', rcNumber: '??' })).toEqual({
      outcome: 'BLOCKED',
      code: 'INVALID_RC_NUMBER',
    });
  });

  it('is blocked for an account that is not active', async () => {
    const store = stubStore({
      subject: { userId: 'u', status: 'SUSPENDED', verificationLevel: 'IDENTITY_VERIFIED' },
    });
    expect(
      await requestBusinessEvidence(deps(store, queues()), { userId: 'u', rcNumber: 'RC123456' }),
    ).toEqual({
      outcome: 'BLOCKED',
      code: 'ACCOUNT_NOT_ACTIVE',
    });
  });

  it('still reports ENQUEUED when the enqueue fails: the request is committed and the sweep expires it', async () => {
    const store = stubStore({ subject: identityVerified });
    const q = queues();
    q.add.mockRejectedValueOnce(new Error('redis down'));
    expect(
      await requestBusinessEvidence(deps(store, q), { userId: 'u', rcNumber: 'RC123456' }),
    ).toMatchObject({
      outcome: 'ENQUEUED',
    });
  });
});
