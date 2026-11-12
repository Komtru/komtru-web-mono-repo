import { describe, expect, it } from 'vitest';
import { cancellationRoutes } from '../../../../src/modules/trades/http/cancellation.routes.js';
import {
  cancellationRequestBodySchema,
  cancellationRequestParamSchema,
  cancellationResponseBodySchema,
  cannotFulfilBodySchema,
} from '../../../../src/modules/trades/http/cancellation.validation.js';
import { routeLabel } from '../../../../src/platform/http/route.js';

const routes = cancellationRoutes(() => {
  throw new Error('not called');
});

describe('cancellation routes (T-066)', () => {
  it('declares the view, the buyer’s request, the seller’s two answers and can’t-fulfil', () => {
    expect(routes.map(routeLabel)).toEqual([
      'GET /trades/:id/cancellation',
      'POST /trades/:id/cancellation-request',
      'POST /trades/:id/cancellation-request/:requestId/approve',
      'POST /trades/:id/cancellation-request/:requestId/decline',
      'POST /trades/:id/cannot-fulfil',
    ]);
  });

  it('serves consumers only, and every action takes an idempotency key and a rate budget', () => {
    expect(new Set(routes.map((r) => r.scope))).toEqual(new Set(['CONSUMER']));
    for (const route of routes.filter((r) => r.method === 'post')) {
      expect(route.retryable, routeLabel(route)).toBe(true);
      expect(route.rateLimit, routeLabel(route)).toBeDefined();
    }
  });
});

describe('cancellation request bodies', () => {
  it('keeps each side to its own reasons (CR1, SC1)', () => {
    expect(cancellationRequestBodySchema.safeParse({ reason: 'CHANGED_MIND' }).success).toBe(true);
    expect(cancellationRequestBodySchema.safeParse({ reason: 'OUT_OF_STOCK' }).success).toBe(false);
    expect(cannotFulfilBodySchema.safeParse({ reason: 'OUT_OF_STOCK' }).success).toBe(true);
    expect(cannotFulfilBodySchema.safeParse({ reason: 'CHANGED_MIND' }).success).toBe(false);
    expect(cannotFulfilBodySchema.safeParse({}).success).toBe(false);
  });

  it('takes no amount, charge or refund from the client', () => {
    const parsed = cancellationRequestBodySchema.parse({
      reason: 'FOUND_CHEAPER',
      amountMinor: '1',
      chargeReference: 'someone-else',
    });
    expect(parsed).toEqual({ reason: 'FOUND_CHEAPER' });
    expect(cancellationResponseBodySchema.parse({ amountMinor: '1' })).toEqual({});
  });

  it('trims a note and refuses an empty or overlong one', () => {
    expect(cancellationResponseBodySchema.parse({ note: '  sorry  ' })).toEqual({ note: 'sorry' });
    expect(cancellationResponseBodySchema.safeParse({ note: '   ' }).success).toBe(false);
    expect(cancellationResponseBodySchema.safeParse({ note: 'x'.repeat(501) }).success).toBe(false);
  });

  it('needs a uuid for the trade and the request', () => {
    expect(cancellationRequestParamSchema.safeParse({ id: 'T-1', requestId: 'r' }).success).toBe(false);
  });
});
