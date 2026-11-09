import { describe, expect, it } from 'vitest';
import { tradeRoutes } from '../../../../src/modules/trades/http/trade.routes.js';
import {
  acceptBodySchema,
  counterBodySchema,
  createTradeBodySchema,
  declineBodySchema,
  sendTradeBodySchema,
} from '../../../../src/modules/trades/http/trade.validation.js';
import { routeLabel } from '../../../../src/platform/http/route.js';

const routes = tradeRoutes(() => {
  throw new Error('not called');
});

describe('trade routes (T-061)', () => {
  it('declares the proposal surface', () => {
    expect(routes.map(routeLabel)).toEqual([
      'POST /trades/preview',
      'POST /trades',
      'GET /trades',
      'GET /trades/by-code/:code',
      'GET /trades/:id',
      'POST /trades/:id/send',
      'POST /trades/:id/counter',
      'POST /trades/:id/accept',
      'POST /trades/:id/decline',
      'POST /trades/:id/cancel',
      'POST /trades/:id/claim',
    ]);
  });

  it('paginates the list by cursor and rate limits it', () => {
    const list = routes.find((r) => routeLabel(r) === 'GET /trades')!;
    expect(list.paginated).toBe('cursor');
    expect(list.rateLimit).toMatchObject({ points: 120, durationSeconds: 60 });
  });

  it('rate limits the lookup by code far harder than any other read, per person and per address', () => {
    const lookup = routes.find((r) => routeLabel(r) === 'GET /trades/by-code/:code')!;
    expect(lookup.rateLimit).toMatchObject({ points: 10, durationSeconds: 60, by: ['user', 'ip'] });
    expect(lookup.rateLimit?.perKey?.ip?.points).toBeLessThanOrEqual(30);
    const list = routes.find((r) => routeLabel(r) === 'GET /trades')!;
    expect(lookup.rateLimit!.points).toBeLessThan(list.rateLimit!.points);
  });

  it('accepts only the canonical trade code in the by-code path', () => {
    const lookup = routes.find((r) => routeLabel(r) === 'GET /trades/by-code/:code')!;
    const params = lookup.schema.params!;
    expect(params.safeParse({ code: 'KMT-7398512-NG' }).success).toBe(true);
    for (const code of [
      'kmt-7398512-ng',
      'KMT-7398512',
      ' KMT-7398512-NG',
      'KMT-123-NG',
      "KMT-1234567-NG' OR 1=1",
    ]) {
      expect(params.safeParse({ code }).success, code).toBe(false);
    }
  });

  it('serves consumers only, and every action takes an idempotency key', () => {
    expect(new Set(routes.map((r) => r.scope))).toEqual(new Set(['CONSUMER']));
    for (const route of routes.filter((r) => r.method === 'post' && !r.path.endsWith('preview'))) {
      expect(route.retryable, routeLabel(route)).toBe(true);
    }
  });
});

describe('trade request bodies', () => {
  it('names the counterparty by exactly one of username, email or phone', () => {
    expect(sendTradeBodySchema.safeParse({ username: 'ada' }).success).toBe(true);
    expect(sendTradeBodySchema.safeParse({}).success).toBe(false);
    expect(sendTradeBodySchema.safeParse({ username: 'ada', email: 'a@b.co' }).success).toBe(false);
  });

  it('reads money as digit-string kobo into a bigint', () => {
    const parsed = createTradeBodySchema.parse({
      role: 'SELLER',
      categoryCode: 'PHONES',
      itemAmountMinor: '45000000',
      itemSpec: { brand: 'Apple' },
      addressId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a01',
    });
    expect(parsed.itemAmountMinor).toBe(45_000_000n);
    expect(createTradeBodySchema.safeParse({ ...parsed, itemAmountMinor: 450000.5 }).success).toBe(false);
  });

  it('rejects a counter that changes nothing', () => {
    expect(counterBodySchema.safeParse({ expectedRevision: 2 }).success).toBe(false);
    expect(counterBodySchema.safeParse({ expectedRevision: 2, proofFileIds: [] }).success).toBe(false);
    expect(counterBodySchema.safeParse({ expectedRevision: 2, itemAmountMinor: '100' }).success).toBe(true);
  });

  it('wants the version on screen to accept, and a reason to decline', () => {
    expect(acceptBodySchema.safeParse({}).success).toBe(false);
    expect(declineBodySchema.safeParse({ reason: ' ' }).success).toBe(false);
  });
});
