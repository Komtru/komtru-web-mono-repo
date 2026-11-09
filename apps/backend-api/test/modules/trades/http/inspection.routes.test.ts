import { describe, expect, it } from 'vitest';
import { inspectionRoutes } from '../../../../src/modules/trades/http/inspection.routes.js';
import { inspectionExtensionBodySchema } from '../../../../src/modules/trades/http/inspection.validation.js';
import { confirmReleaseBodySchema } from '../../../../src/modules/trades/domain/inspection.js';
import { routeLabel } from '../../../../src/platform/http/route.js';

const routes = inspectionRoutes(() => {
  throw new Error('not called');
});

describe('inspection routes (T-065)', () => {
  it('declares the comparison, the extension request and the confirm-and-release surface', () => {
    expect(routes.map(routeLabel)).toEqual([
      'GET /trades/:id/inspection',
      'POST /trades/:id/inspection-extension',
      'POST /trades/:id/inspection-extension/:requestId/accept',
      'POST /trades/:id/inspection-extension/:requestId/decline',
      'POST /trades/:id/accept-inspection',
    ]);
  });

  it('serves consumers only, and every action takes an idempotency key', () => {
    expect(new Set(routes.map((r) => r.scope))).toEqual(new Set(['CONSUMER']));
    for (const route of routes.filter((r) => r.method === 'post')) {
      expect(route.retryable, routeLabel(route)).toBe(true);
    }
  });

  it('refuses confirm-and-release without the explicit acknowledgement', () => {
    const route = routes.find((r) => routeLabel(r) === 'POST /trades/:id/accept-inspection');
    expect(route?.schema.body).toBe(confirmReleaseBodySchema);
    expect(confirmReleaseBodySchema.safeParse({}).success).toBe(false);
  });
});

describe('inspection request bodies', () => {
  it('reads a whole number of extra hours and an optional note', () => {
    expect(inspectionExtensionBodySchema.parse({ extraHours: 24, note: ' away ' })).toEqual({
      extraHours: 24,
      note: 'away',
    });
    for (const body of [
      {},
      { extraHours: 0 },
      { extraHours: 1.5 },
      { extraHours: '24' },
      { extraHours: 24, note: '' },
    ]) {
      expect(inspectionExtensionBodySchema.safeParse(body).success).toBe(false);
    }
  });
});
