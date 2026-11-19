// The dispute contract, pinned against the backend's own route table (F-032).
//
// The point of this file is drift. `src/disputes.ts` is a hand-written mirror of
// `apps/backend-api/src/modules/disputes/http/routes.ts`, and a mirror nobody checks is a mirror
// that is wrong six weeks later — the symptom being a 404 in the app and a perfectly healthy
// backend. So the test imports the real route array and compares, rather than restating the paths.
import { describe, expect, it } from 'vitest';
import { disputeRoutes } from '../../../apps/backend-api/src/modules/disputes/http/routes.js';
import type { DisputePorts } from '../../../apps/backend-api/src/modules/disputes/services/ports.js';
import * as client from '../src/disputes.js';
import { DECISION_OUTCOMES, DISPUTE_STATUSES } from '../src/disputes.js';

const backend = disputeRoutes({
  db: () => {
    throw new Error('the route table must be buildable without a database');
  },
  ports: () => ({}) as DisputePorts,
});

/** Every `defineEndpoint` this module exports, by its own method and path. */
const endpoints = Object.values(client).filter(
  (
    value,
  ): value is { method: string; path: string; scope: string; retryable?: boolean; paginated?: string } =>
    typeof value === 'object' && value !== null && 'method' in value && 'path' in value && 'schema' in value,
);

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
