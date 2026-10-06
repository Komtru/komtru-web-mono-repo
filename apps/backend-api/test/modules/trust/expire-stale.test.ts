// §6.2's floor. The case that matters is the one the fake scripts deliberately: a provider that
// accepts a check and never answers.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { runExpireStale } from '../../../src/modules/trust/jobs/expire-stale.job.js';
import type { TrustJobDeps } from '../../../src/modules/trust/jobs/deps.js';
import type { ExpiredRequest } from '../../../src/modules/trust/infrastructure/postgres/store.js';
import {
  containing,
  recordingGateway,
  scriptedAdapter,
  silentLogger,
  stubStore,
  testEncryption,
  testHasher,
} from './support.js';

const sweep = async (expired: ExpiredRequest[]) => {
  const store = stubStore({ expired });
  const gateway = recordingGateway();
  const deps: TrustJobDeps = {
    store,
    // Nothing here calls a provider: expiry is the ABSENCE of an answer, so an adapter that throws
    // on every method is the right stub — it would fail loudly if the sweep ever reached for one.
    adapter: scriptedAdapter(),
    hasher: testHasher(),
    encryption: testEncryption(),
    gateway,
    logger: silentLogger(),
  };
  const result = await runExpireStale(deps, new Date());
  return { result, store, emitted: gateway.emitted };
};

const expiredRow = (): ExpiredRequest => ({
  requestId: randomUUID(),
  userId: randomUUID(),
  verificationType: 'NIN',
  attemptCount: 1,
});

describe('runExpireStale', () => {
  it('reports what it expired', async () => {
    const { result } = await sweep([expiredRow(), expiredRow()]);
    expect(result).toEqual({ expired: 2 });
  });

  it('grants no level on expiry — the absence of an answer is not a negative one', async () => {
    const { store } = await sweep([expiredRow()]);
    expect(store.grants).toHaveLength(0);
  });

  it('tells the user, so a screen that has been spinning since yesterday stops', async () => {
    const row = expiredRow();
    const { emitted } = await sweep([row]);
    expect(emitted).toEqual([
      {
        userId: row.userId,
        event: 'verification:updated',
        payload: containing({ requestId: row.requestId, status: 'EXPIRED' }),
      },
    ]);
  });

  it('does nothing, and says nothing, when there is nothing to sweep', async () => {
    const { result, emitted } = await sweep([]);
    expect(result).toEqual({ expired: 0 });
    expect(emitted).toEqual([]);
  });
});
