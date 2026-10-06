import { paginatedSchema, pagedSchema } from '@komtru/shared-types';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { assertRouteInvariants, defineRoute, isCollectionSchema } from '../../../src/platform/http/route.js';

const item = z.object({ id: z.uuid() });
const ok = { ok: z.boolean() };

const getCollection = (overrides = {}) =>
  defineRoute({
    method: 'get',
    path: '/trades',
    scope: 'CONSUMER',
    summary: 'List trades',
    schema: { response: paginatedSchema(item) },
    handler: () => Promise.resolve({ items: [], nextCursor: null }),
    ...overrides,
  });

const postRoute = (overrides = {}) =>
  defineRoute({
    method: 'post',
    path: '/trades',
    scope: 'CONSUMER',
    summary: 'Open a trade',
    schema: { body: z.object(ok), response: item },
    handler: () => Promise.resolve({ id: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b' }),
    ...overrides,
  });

describe('isCollectionSchema', () => {
  it.each([
    ['a cursor page', paginatedSchema(item)],
    ['a numbered page', pagedSchema(item)],
    ['a bare array', z.array(item)],
    // A collection must stay recognisable however it is dressed, or the pagination invariant is
    // one `.transform()` away from being optional.
    ['a transformed page', paginatedSchema(item).transform((page) => page)],
    ['a readonly page', paginatedSchema(item).readonly()],
    ['a lazy page', z.lazy(() => paginatedSchema(item))],
    ['a union with a page in it', z.union([item, paginatedSchema(item)])],
    ['a transformed array', z.array(item).transform((rows) => rows)],
    ['a page whose items are lazy', z.object({ items: z.lazy(() => z.array(item)), nextCursor: z.null() })],
  ])('is true for %s', (_label, schema) => expect(isCollectionSchema(schema as z.ZodType)).toBe(true));

  it.each([
    ['a single resource', item],
    ['a transformed single resource', item.transform((one) => one)],
    ['an object with a non-array items field', z.object({ items: z.string() })],
  ])('is false for %s', (_label, schema) => expect(isCollectionSchema(schema as z.ZodType)).toBe(false));
});

describe('assertRouteInvariants', () => {
  it('rejects a GET collection that does not declare pagination', () => {
    expect(() => assertRouteInvariants([getCollection()])).toThrow(/GET \/trades.*paginated/s);
  });

  it('accepts a GET collection that declares pagination', () => {
    expect(() => assertRouteInvariants([getCollection({ paginated: 'cursor' })])).not.toThrow();
  });

  it('rejects a mutating route with no retryable decision', () => {
    expect(() => assertRouteInvariants([postRoute()])).toThrow(/POST \/trades.*retryable/s);
  });

  it.each([true, false])('accepts a mutating route that decides retryable: %s', (retryable) => {
    expect(() => assertRouteInvariants([postRoute({ retryable })])).not.toThrow();
  });

  it('rejects two routes on the same method and path', () => {
    const routes = [postRoute({ retryable: true }), postRoute({ retryable: true })];
    expect(() => assertRouteInvariants(routes)).toThrow(/duplicate route POST \/trades/);
  });

  it('allows the same path on different methods', () => {
    expect(() =>
      assertRouteInvariants([postRoute({ retryable: true }), getCollection({ paginated: 'cursor' })]),
    ).not.toThrow();
  });

  it('rejects a path with parameters and no params schema', () => {
    expect(() => assertRouteInvariants([postRoute({ retryable: true, path: '/trades/:id/offers' })])).toThrow(
      /needs a params schema/,
    );
  });

  it('rejects a path that does not start with a slash', () => {
    expect(() => assertRouteInvariants([postRoute({ retryable: true, path: 'trades' })])).toThrow(
      /must start with/,
    );
  });

  it('rejects pagination on a route that does not return a collection', () => {
    expect(() =>
      assertRouteInvariants([
        defineRoute({
          method: 'get',
          path: '/trades/:id',
          scope: 'CONSUMER',
          summary: 'One trade',
          paginated: 'cursor',
          schema: { response: item },
          handler: () => Promise.resolve({ id: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b' }),
        }),
      ]),
    ).toThrow(/does not return a collection/);
  });

  it('names every offending route, not just the first', () => {
    expect(() => assertRouteInvariants([getCollection(), postRoute()])).toThrow(
      /GET \/trades[\s\S]*POST \/trades/,
    );
  });
});

describe('assertRouteInvariants and PUBLIC routes', () => {
  it('refuses a permission on a route anyone may call', () => {
    expect(() =>
      assertRouteInvariants([
        defineRoute({
          method: 'get',
          path: '/open',
          scope: 'PUBLIC',
          permission: 'user.view',
          summary: 'Open',
          schema: { response: z.object({ ok: z.boolean() }) },
          handler: () => Promise.resolve({ ok: true }),
        }),
      ]),
    ).toThrow(/can never be checked/);
  });
});

describe('the rate-limit keys a route may declare', () => {
  const limited = (rateLimit: object) => postRoute({ retryable: false, rateLimit });

  it('refuses a route that limits by identifier but cannot find one', () => {
    expect(() =>
      assertRouteInvariants([limited({ points: 1, durationSeconds: 60, by: ['identifier'] })]),
    ).toThrow(/rate limits by identifier but provides no identifierFrom/);
  });

  it('refuses a route that limits by device but cannot find one', () => {
    expect(() =>
      assertRouteInvariants([limited({ points: 1, durationSeconds: 60, by: ['device'] })]),
    ).toThrow(/rate limits by device but provides no deviceFrom/);
  });

  it('accepts a route that supplies deviceFrom', () => {
    expect(() =>
      assertRouteInvariants([
        limited({ points: 1, durationSeconds: 60, by: ['device'], deviceFrom: () => 'fp' }),
      ]),
    ).not.toThrow();
  });

  it('accepts ip and user with no extractor, because the request already carries both', () => {
    expect(() =>
      assertRouteInvariants([limited({ points: 1, durationSeconds: 60, by: ['ip', 'user'] })]),
    ).not.toThrow();
  });
});
