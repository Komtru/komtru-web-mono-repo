import { describe, expect, it } from 'vitest';
import { fulfilmentRoutes } from '../../../../src/modules/trades/http/fulfilment.routes.js';
import {
  extensionBodySchema,
  selfArrangedBodySchema,
} from '../../../../src/modules/trades/http/fulfilment.validation.js';
import { routeLabel } from '../../../../src/platform/http/route.js';

const routes = fulfilmentRoutes(() => {
  throw new Error('not called');
});

describe('fulfilment routes (T-064)', () => {
  it('declares the ship, delivery and deadline surface', () => {
    expect(routes.map(routeLabel)).toEqual([
      'GET /trades/:id/ship-options',
      'POST /trades/:id/ship/self-arranged',
      'POST /trades/:id/confirm-delivery',
      'POST /trades/:id/report-delivered',
      'GET /trades/:id/delivery-deadline',
      'POST /trades/:id/delivery-extension',
      'POST /trades/:id/delivery-extension/:requestId/accept',
      'POST /trades/:id/delivery-extension/:requestId/decline',
    ]);
  });

  it('serves consumers only, and every action takes an idempotency key', () => {
    expect(new Set(routes.map((r) => r.scope))).toEqual(new Set(['CONSUMER']));
    for (const route of routes.filter((r) => r.method === 'post')) {
      expect(route.retryable, routeLabel(route)).toBe(true);
    }
  });
});

describe('fulfilment request bodies', () => {
  it('needs all four self-arranged fields', () => {
    expect(selfArrangedBodySchema.safeParse({}).success).toBe(false);
    expect(
      selfArrangedBodySchema.safeParse({
        waybillNumber: 'WB-1234',
        receiptFileId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a01',
        driverPhone: '08031234567',
        vehiclePlate: 'abc123',
      }).success,
    ).toBe(true);
  });

  it('reads an extension request as one of the three reasons and an ISO date', () => {
    const parsed = extensionBodySchema.parse({
      reason: 'RESTOCKING_ITEM',
      requestedDueAt: '2026-11-12T18:00:00.000Z',
      note: ' soon ',
    });
    expect(parsed.requestedDueAt).toEqual(new Date('2026-11-12T18:00:00.000Z'));
    expect(parsed.note).toBe('soon');
    expect(
      extensionBodySchema.safeParse({ reason: 'BORED', requestedDueAt: '2026-11-12T18:00:00.000Z' }).success,
    ).toBe(false);
    expect(
      extensionBodySchema.safeParse({ reason: 'RESTOCKING_ITEM', requestedDueAt: 'tomorrow' }).success,
    ).toBe(false);
  });
});
