// The M6 §11 user surface, read off the declarations the platform checks at boot, plus the one
// read model behind it.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RouteDefinition } from '../../../src/platform/http/route.js';
import { routeLabel } from '../../../src/platform/http/route.js';
import { trustRoutes } from '../../../src/modules/trust/http/routes.js';
import { bvnBody, ninBody, livenessBody } from '../../../src/modules/trust/http/validations.js';
import { readVerificationStatus } from '../../../src/modules/trust/services/verification.service.js';
import { requestRow, silentLogger, stubStore, testEncryption, testHasher } from './support.js';
import { testModule } from '../../support/modules.js';

const deps = {
  store: () => stubStore(),
  hasher: () => testHasher(),
  encryption: () => testEncryption(),
  requestTtlMinutes: () => 60,
  logger: () => silentLogger(),
  queues: () => ({ producer: () => ({ add: async () => undefined }) }) as never,
};

const routes: RouteDefinition[] = trustRoutes(deps);
const labels = routes.map(routeLabel);
const routeFor = (label: string): RouteDefinition => {
  const found = routes.find((route) => routeLabel(route) === label);
  if (!found) throw new Error(`no route ${label}`);
  return found;
};

describe('trustRoutes', () => {
  it('declares the M6 §11 user surface and nothing admin-facing yet', () => {
    expect(labels).toEqual([
      'POST /verification/nin',
      'POST /verification/bvn',
      'POST /verification/liveness',
      'GET /verification/status',
    ]);
  });

  it('scopes every route to CONSUMER', () => {
    for (const route of routes) expect(route.scope).toBe('CONSUMER');
  });

  it('rate-limits each submission on both the IP and the user, because each one costs money', () => {
    for (const label of labels.filter((l) => l.startsWith('POST'))) {
      expect(routeFor(label).rateLimit?.by).toEqual(expect.arrayContaining(['ip', 'user']));
    }
  });

  it('answers 202, because the provider is never called on the request path', () => {
    for (const label of labels.filter((l) => l.startsWith('POST'))) {
      expect(routeFor(label).status).toBe(202);
    }
  });

  it('states a retryable decision on every mutating route', () => {
    for (const label of labels.filter((l) => l.startsWith('POST'))) {
      expect(typeof routeFor(label).retryable).toBe('boolean');
    }
  });

  it('is what the registry mounts', () => {
    expect((testModule('trust').routes ?? []).map(routeLabel)).toEqual(labels);
  });
});

describe('request bodies', () => {
  it('rejects a body carrying an unexpected field', () => {
    expect(ninBody.safeParse({ nin: '12345678904', firstName: 'A', lastName: 'B', note: 'x' }).success).toBe(
      false,
    );
  });

  it('accepts the fields the KYC form collects', () => {
    expect(
      ninBody.safeParse({
        nin: '123-456-789-04',
        firstName: 'Ada',
        lastName: 'Obi',
        dateOfBirth: '1994-02-03',
      }).success,
    ).toBe(true);
    expect(bvnBody.safeParse({ bvn: '12345678904', firstName: 'Ada', lastName: 'Obi' }).success).toBe(true);
  });

  it('wants a uuid for the selfie, not any string a client invents', () => {
    expect(livenessBody.safeParse({ selfieFileId: 'not-a-uuid' }).success).toBe(false);
    expect(livenessBody.safeParse({ selfieFileId: randomUUID() }).success).toBe(true);
  });

  it('refuses a date of birth that is not a date', () => {
    expect(
      ninBody.safeParse({ nin: '12345678904', firstName: 'A', lastName: 'B', dateOfBirth: 'yesterday' })
        .success,
    ).toBe(false);
  });
});

describe('readVerificationStatus', () => {
  it('reports the level, what is still needed, and what is in flight', async () => {
    const userId = randomUUID();
    const open = requestRow({ userId, verificationType: 'NIN', status: 'PROVIDER_PENDING' });
    const store = stubStore({
      subject: { userId, status: 'ACTIVE', verificationLevel: 'CONTACT_VERIFIED' },
      facts: { identifierVerified: true, latestVerifiedIdentifier: 'NIN', livenessPassed: false },
      openRequests: [open],
    });

    const status = await readVerificationStatus({ store } as never, userId);

    expect(status).toMatchObject({
      level: 'CONTACT_VERIFIED',
      levelNumber: 1,
      requirements: { identifier: true, liveness: false },
      inFlight: [{ requestId: open.id, type: 'NIN', status: 'PROVIDER_PENDING' }],
    });
  });

  it('never echoes anything that could identify the number behind a check', async () => {
    const userId = randomUUID();
    const store = stubStore({ openRequests: [requestRow({ userId })] });
    const status = await readVerificationStatus({ store } as never, userId);
    expect(JSON.stringify(status)).not.toMatch(/masked|hash|nin_|bvn_/i);
  });

  it('refuses a caller whose user row is gone', async () => {
    await expect(
      readVerificationStatus({ store: stubStore({ subject: undefined }) } as never, randomUUID()),
    ).rejects.toMatchObject({ status: 401 });
  });
});
