// Accepting a NIN or a BVN. Everything that happens before a provider is involved: the guards, the
// 409s, and — the point of the whole arrangement — the fact that nothing written or enqueued here
// carries the number the user typed.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { submitIdentifierCheck } from '../../../src/modules/trust/services/verification.service.js';
import {
  requestRow,
  silentLogger,
  stubStore,
  testEncryption,
  testHasher,
  uniqueViolation,
} from './support.js';

const encryption = testEncryption();

const deps = (store = stubStore()) => ({
  store,
  hasher: testHasher(),
  encryption,
  requestTtlMinutes: 60,
  logger: silentLogger(),
});

const input = (overrides: Record<string, unknown> = {}) => ({
  userId: randomUUID(),
  type: 'NIN' as const,
  identifier: '12345678904',
  firstName: 'Ada',
  lastName: 'Obi',
  ...overrides,
});

describe('submitIdentifierCheck', () => {
  it('refuses a user who has not verified their contact channels (M6 §2)', async () => {
    const store = stubStore({
      subject: { userId: 'u', status: 'ACTIVE', verificationLevel: 'UNVERIFIED' },
    });
    await expect(submitIdentifierCheck(deps(store), input())).rejects.toMatchObject({
      status: 409,
      code: 'CONTACT_VERIFICATION_REQUIRED',
    });
  });

  it('refuses a user who is not ACTIVE', async () => {
    const store = stubStore({
      subject: { userId: 'u', status: 'SUSPENDED', verificationLevel: 'CONTACT_VERIFIED' },
    });
    await expect(submitIdentifierCheck(deps(store), input())).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a user who does not exist, without saying so', async () => {
    await expect(
      submitIdentifierCheck(deps(stubStore({ subject: undefined })), input()),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('refuses a malformed number before it costs a provider call', async () => {
    await expect(submitIdentifierCheck(deps(), input({ identifier: '123' }))).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_FAILED',
    });
  });

  it('accepts a number the user typed with separators', async () => {
    const store = stubStore();
    await expect(
      submitIdentifierCheck(deps(store), input({ identifier: '123-456-789-04' })),
    ).resolves.toMatchObject({ status: 'SUBMITTED' });
  });

  it('translates the in-flight unique index into a 409, read through drizzle’s wrapping', async () => {
    const store = stubStore({
      createRequestThrows: uniqueViolation('verification_requests_one_in_flight'),
    });
    await expect(submitIdentifierCheck(deps(store), input())).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
    });
  });

  it('rethrows a violation it does not recognise rather than calling every error a conflict', async () => {
    const store = stubStore({ createRequestThrows: uniqueViolation('some_other_index') });
    await expect(submitIdentifierCheck(deps(store), input())).rejects.not.toMatchObject({ status: 409 });
  });

  it('refuses a second submission of a type the user has already verified', async () => {
    // Cheaper and clearer than letting the job discover it: no provider call is spent, and the user
    // is told the truth rather than being parked in a review queue that does not exist yet.
    const store = stubStore({ facts: { identifierVerified: true, verifiedTypes: ['NIN'] } });
    await expect(submitIdentifierCheck(deps(store), input())).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
    });
    expect(store.requests).toHaveLength(0);
  });

  it('still accepts a BVN from a user who has already verified a NIN', async () => {
    const store = stubStore({ facts: { identifierVerified: true, verifiedTypes: ['NIN'] } });
    await expect(submitIdentifierCheck(deps(store), input({ type: 'BVN' }))).resolves.toMatchObject({
      status: 'SUBMITTED',
    });
  });

  it('tells a user waiting on a human something different from a user waiting on a provider', async () => {
    const running = stubStore({
      createRequestThrows: uniqueViolation('verification_requests_one_in_flight'),
    });
    const underReview = stubStore({
      createRequestThrows: uniqueViolation('verification_requests_one_in_flight'),
      openRequests: [requestRow({ verificationType: 'NIN', status: 'MANUAL_REVIEW' })],
    });

    const first = await submitIdentifierCheck(deps(running), input()).catch((e: unknown) => e);
    const second = await submitIdentifierCheck(deps(underReview), input()).catch((e: unknown) => e);

    expect((first as { detail: string }).detail).not.toBe((second as { detail: string }).detail);
    expect((second as { detail: string }).detail).toMatch(/review/i);
  });

  it('writes no raw identifier into the request row', async () => {
    const store = stubStore();
    await submitIdentifierCheck(deps(store), input());
    expect(JSON.stringify(store.requests)).not.toContain('12345678904');
  });

  it('seals the whole claim into the job payload rather than enqueuing it in the clear', async () => {
    const result = await submitIdentifierCheck(deps(), input());
    expect(result.job.sealed).not.toContain('12345678904');
    expect(result.job.sealed).not.toContain('Ada');
    expect(JSON.parse(encryption.decrypt(result.job.sealed))).toMatchObject({
      identifier: '12345678904',
      firstName: 'Ada',
      lastName: 'Obi',
    });
  });

  it('carries the attempt count forward, so §9’s two-in-30-days rule has something to count', async () => {
    const store = stubStore({ attempts: 2 });
    await submitIdentifierCheck(deps(store), input());
    expect(store.requests[0]?.attemptCount).toBe(3);
  });
});
