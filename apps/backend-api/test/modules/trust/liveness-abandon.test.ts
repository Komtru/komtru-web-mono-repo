// Closing the Youverify SDK without finishing.
//
// The property worth protecting: a person who opens the camera flow and changes their mind must be
// able to start again immediately. Before this existed the request sat at PROVIDER_PENDING until
// the §6.2 sweep expired it a day later, and VF1 showed "We're checking" over a check nobody was
// performing — with no control to retry, because the start branch only renders when nothing is in
// flight.
//
// Abandoning is NOT a verdict. It reuses the EXPIRED terminal status, but carries its own reason so
// the status endpoint can leave it out of `rejections`: the platform never said anything about this
// person's face, so VF1 must not show them a failure.
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../src/platform/errors.js';
import { abandonLivenessSession } from '../../../src/modules/trust/services/verification.service.js';
import { requestRow, silentLogger, testEncryption, testHasher } from './support.js';

const REQUEST_ID = '8f1d4f0e-4c9a-4a4b-9f2e-9d3c1b2a7e55';

const deps = (all: Record<string, unknown> = {}) => {
  const { store: storeOverride, ...overrides } = all;
  const abandoned: unknown[] = [];
  const store = {
    // The conditional UPDATE. `true` means this call is the one that moved the row.
    abandonLiveness: (input: unknown) => {
      abandoned.push(input);
      return Promise.resolve(true);
    },
    findRequest: () =>
      Promise.resolve(
        requestRow({
          id: REQUEST_ID,
          userId: 'u1',
          verificationType: 'LIVENESS',
          status: 'PROVIDER_PENDING',
        }),
      ),
    ...((storeOverride as Record<string, unknown>) ?? {}),
  };
  return {
    abandoned,
    deps: {
      store: store as never,
      hasher: testHasher(),
      encryption: testEncryption(),
      requestTtlMinutes: 60,
      logger: silentLogger(),
      ...overrides,
    } as never,
  };
};

describe('abandonLivenessSession', () => {
  it('ends a pending session so the screen can offer the camera again', async () => {
    const { deps: d, abandoned } = deps();

    const result = await abandonLivenessSession(d, { userId: 'u1', requestId: REQUEST_ID });

    expect(result.abandoned).toBe(true);
    // Scoped to the caller in the UPDATE itself, not by a read-then-write a second request could
    // interleave with.
    expect(abandoned).toEqual([{ userId: 'u1', requestId: REQUEST_ID }]);
  });

  it('does not read the row at all when the update moved it', async () => {
    let reads = 0;
    const { deps: d } = deps({
      store: {
        findRequest: () => {
          reads += 1;
          return Promise.resolve(undefined);
        },
      },
    });

    await abandonLivenessSession(d, { userId: 'u1', requestId: REQUEST_ID });

    expect(reads).toBe(0);
  });

  it('treats a second close as success rather than an error', async () => {
    // Two `onClose` calls, or one retried over a flaky connection: the second moves nothing.
    const { deps: d } = deps({
      store: {
        abandonLiveness: () => Promise.resolve(false),
        findRequest: () =>
          Promise.resolve(
            requestRow({
              id: REQUEST_ID,
              userId: 'u1',
              verificationType: 'LIVENESS',
              status: 'EXPIRED',
              rejectionReason: 'ABANDONED',
            }),
          ),
      },
    });

    const result = await abandonLivenessSession(d, { userId: 'u1', requestId: REQUEST_ID });

    expect(result.abandoned).toBe(false);
  });

  it('refuses a request that belongs to somebody else', async () => {
    const { deps: d } = deps({
      store: {
        abandonLiveness: () => Promise.resolve(false),
        findRequest: () =>
          Promise.resolve(
            requestRow({
              id: REQUEST_ID,
              userId: 'someone-else',
              verificationType: 'LIVENESS',
              status: 'PROVIDER_PENDING',
            }),
          ),
      },
    });

    await expect(abandonLivenessSession(d, { userId: 'u1', requestId: REQUEST_ID })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('answers 404 rather than leaking that an unknown id exists', async () => {
    const { deps: d } = deps({
      store: {
        abandonLiveness: () => Promise.resolve(false),
        findRequest: () => Promise.resolve(undefined),
      },
    });

    await expect(abandonLivenessSession(d, { userId: 'u1', requestId: REQUEST_ID })).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it('refuses to discard a check the platform has already decided', async () => {
    // An approved liveness check is a level. Abandoning it would take one away.
    const { deps: d } = deps({
      store: {
        abandonLiveness: () => Promise.resolve(false),
        findRequest: () =>
          Promise.resolve(
            requestRow({
              id: REQUEST_ID,
              userId: 'u1',
              verificationType: 'LIVENESS',
              status: 'APPROVED',
            }),
          ),
      },
    });

    await expect(abandonLivenessSession(d, { userId: 'u1', requestId: REQUEST_ID })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('refuses to abandon a check that is not a liveness session', async () => {
    const { deps: d } = deps({
      store: {
        abandonLiveness: () => Promise.resolve(false),
        findRequest: () =>
          Promise.resolve(
            requestRow({
              id: REQUEST_ID,
              userId: 'u1',
              verificationType: 'NIN',
              status: 'PROVIDER_PENDING',
            }),
          ),
      },
    });

    await expect(abandonLivenessSession(d, { userId: 'u1', requestId: REQUEST_ID })).rejects.toMatchObject({
      status: 409,
    });
  });
});
