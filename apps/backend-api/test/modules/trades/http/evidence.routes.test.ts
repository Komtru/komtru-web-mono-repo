import { describe, expect, it } from 'vitest';
import { evidenceRoutes } from '../../../../src/modules/trades/http/evidence.routes.js';
import {
  attachEvidenceBodySchema,
  listEvidenceQuerySchema,
} from '../../../../src/modules/trades/http/evidence.validation.js';
import { assertRouteInvariants, routeLabel } from '../../../../src/platform/http/route.js';

const routes = evidenceRoutes(() => {
  throw new Error('not called');
});

describe('evidence routes (F-028)', () => {
  it('declares the attach and list surface for consumers only, and passes the mount-time checks', () => {
    expect(routes.map(routeLabel)).toEqual(['POST /trades/:id/evidence', 'GET /trades/:id/evidence']);
    expect(new Set(routes.map((r) => r.scope))).toEqual(new Set(['CONSUMER']));
    expect(routes.every((r) => r.permission === undefined)).toBe(true);
    expect(routes.find((r) => r.method === 'post')?.retryable).toBe(true);
    expect(routes.find((r) => r.method === 'get')?.paginated).toBe('cursor');
    expect(() => {
      assertRouteInvariants(routes);
    }).not.toThrow();
  });
});

describe('evidence request shapes', () => {
  const file = '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a01';

  it('needs one of the four events and between one and ten file ids', () => {
    expect(attachEvidenceBodySchema.safeParse({ event: 'DELIVERY', fileIds: [file] }).success).toBe(true);
    expect(attachEvidenceBodySchema.safeParse({ event: 'DELIVERY', fileIds: [] }).success).toBe(false);
    expect(
      attachEvidenceBodySchema.safeParse({
        event: 'DELIVERY',
        fileIds: Array.from({ length: 11 }, () => file),
      }).success,
    ).toBe(false);
    // Listing is the seller's proof, not evidence added here.
    expect(attachEvidenceBodySchema.safeParse({ event: 'LISTING', fileIds: [file] }).success).toBe(false);
    expect(attachEvidenceBodySchema.safeParse({ event: 'ISSUE', fileIds: [file], extra: 1 }).success).toBe(
      false,
    );
  });

  it('filters a read by one event or none', () => {
    expect(listEvidenceQuerySchema.safeParse({}).success).toBe(true);
    expect(listEvidenceQuerySchema.safeParse({ event: 'INSPECTION' }).success).toBe(true);
    expect(listEvidenceQuerySchema.safeParse({ event: 'LISTING' }).success).toBe(false);
  });
});
