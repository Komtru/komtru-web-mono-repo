// The dispute contract, pinned against the backend's own route table (F-032).
//
// The point of this file is drift. `src/disputes.ts` is a hand-written mirror of
// `apps/backend-api/src/modules/disputes/http/routes.ts`, and a mirror nobody checks is a mirror
// that is wrong six weeks later — the symptom being a 404 in the app and a perfectly healthy
// backend. So the test imports the real route array and compares, rather than restating the paths.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as client from '../src/disputes.js';
import { DECISION_OUTCOMES, DISPUTE_STATUSES } from '../src/disputes.js';

/**
 * The backend's route table, read as SOURCE rather than imported. Importing across the package
 * boundary would pull `apps/backend-api` into this package's `rootDir` and break its typecheck —
 * the precedent is `evidence.test.ts`, which reads the files module's policy the same way.
 */
const source = readFileSync(
  new URL('../../../apps/backend-api/src/modules/disputes/http/routes.ts', import.meta.url),
  'utf8',
);

/** Every `defineRoute({ method, path, scope, … })` in the backend, as the fields we compare on. */
const backend = [...source.matchAll(/defineRoute\(\{([\s\S]*?)\n {4}\}\)/g)].map((match) => {
  const block = match[1] ?? '';
  const field = (name: string): string | undefined => new RegExp(`\\b${name}: '([^']+)'`).exec(block)?.[1];
  return {
    method: field('method') ?? '',
    path: field('path') ?? '',
    scope: field('scope') ?? '',
    retryable: /\bretryable: true\b/.test(block),
    paginated: field('paginated'),
  };
});

it('read the backend route table at all', () => {
  // A regex that silently matched nothing would make every assertion below vacuously true.
  expect(backend.length).toBeGreaterThanOrEqual(18);
  for (const route of backend) {
    expect(route.method, JSON.stringify(route)).not.toBe('');
    expect(route.path, JSON.stringify(route)).not.toBe('');
  }
});

interface RouteShape {
  method: string;
  path: string;
  scope: string;
  retryable?: boolean;
  paginated?: string;
}

/**
 * Every `defineEndpoint` this module exports, reduced to the fields compared below. The module
 * also exports schemas and constant tuples, so endpoints are picked out by shape rather than from
 * a hand-kept list: a new one is covered the moment it is added.
 */
const endpoints: RouteShape[] = Object.values(client as Record<string, unknown>).flatMap((value) => {
  if (typeof value !== 'object' || value === null) return [];
  const candidate = value as Partial<RouteShape> & { schema?: unknown };
  if (typeof candidate.method !== 'string' || typeof candidate.path !== 'string') return [];
  if (candidate.schema === undefined) return [];
  return [
    {
      method: candidate.method,
      path: candidate.path,
      scope: candidate.scope ?? '',
      ...(candidate.retryable === undefined ? {} : { retryable: candidate.retryable }),
      ...(candidate.paginated === undefined ? {} : { paginated: candidate.paginated }),
    },
  ];
});

const key = (r: { method: string; path: string }) => `${r.method.toUpperCase()} ${r.path}`;

describe('the client mirrors the backend', () => {
  it('points every endpoint at a route that exists', () => {
    const real = new Set(backend.map(key));
    for (const endpoint of endpoints) {
      expect(real, `${key(endpoint)} is not a backend route`).toContain(key(endpoint));
    }
  });

  it('covers every consumer route the backend serves', () => {
    const consumer = backend
      .filter((r) => r.scope === 'CONSUMER')
      .map(key)
      .sort();
    const mirrored = endpoints.map(key).sort();
    expect(mirrored).toEqual(consumer);
  });

  it('agrees with the backend on which calls carry an idempotency key', () => {
    const byPath = new Map(backend.map((r) => [key(r), r]));
    for (const endpoint of endpoints) {
      const route = byPath.get(key(endpoint));
      // A client that thinks a route is retryable when it is not will send a key the platform
      // ignores, and silently lose at-most-once on a retry.
      expect(endpoint.retryable ?? false, key(endpoint)).toBe(route?.retryable ?? false);
    }
  });

  it('agrees with the backend on which calls are paginated', () => {
    const byPath = new Map(backend.map((r) => [key(r), r]));
    for (const endpoint of endpoints) {
      expect(endpoint.paginated, key(endpoint)).toBe(byPath.get(key(endpoint))?.paginated);
    }
  });

  it('never exposes a staff route from the consumer client', () => {
    for (const endpoint of endpoints) expect(endpoint.scope).toBe('CONSUMER');
  });
});

describe('the shared vocabulary', () => {
  it('keeps the four money outcomes', () => {
    expect([...DECISION_OUTCOMES]).toEqual([
      'REFUND_BUYER_FULL',
      'REFUND_BUYER_PARTIAL',
      'RELEASE_SELLER_FULL',
      'RELEASE_SELLER_PARTIAL',
    ]);
  });

  it('opens in mediation and ends closed', () => {
    expect(DISPUTE_STATUSES[0]).toBe('MEDIATION');
    expect(DISPUTE_STATUSES.at(-1)).toBe('CLOSED');
  });
});

describe('the money fields', () => {
  it('refuses a JSON number anywhere an amount is read', () => {
    const base = {
      id: '11111111-1111-4111-8111-111111111111',
      disputeId: '11111111-1111-4111-8111-111111111111',
      decisionType: 'ORIGINAL',
      decidedByUserId: '22222222-2222-4222-8222-222222222222',
      outcome: 'REFUND_BUYER_FULL',
      amountToBuyerMinor: '45200000',
      amountToSellerMinor: '0',
      appealOutcome: null,
      rationale: 'the colour did not match',
      agreedNote: null,
      decidedAt: '2026-11-25T12:00:00.000Z',
    };
    expect(client.decisionSchema.safeParse(base).success).toBe(true);
    expect(client.decisionSchema.safeParse({ ...base, amountToBuyerMinor: 45_200_000 }).success).toBe(false);
  });
});
