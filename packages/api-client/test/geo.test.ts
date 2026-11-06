import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/client.js';
import {
  GEO_PAGE_LIMIT,
  fetchAllCities,
  fetchAllStates,
  getCity,
  listStateCities,
  listStates,
  searchCities,
  submitCityRequest,
} from '../src/geo.js';

const id = (n: number) => `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const state = (n: number) => ({ id: id(n), code: 'LA', name: `State ${n}` });
const city = (n: number, stateId = id(1)) => ({ id: id(100 + n), stateId, name: `City ${n}`, active: true });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fetch that serves pages in order and records every URL it was asked for. */
const pagedFetch = (pages: unknown[]) => {
  const urls: string[] = [];
  const fetch = vi.fn((input: URL | RequestInfo) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return Promise.resolve(json(pages[urls.length - 1]));
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, urls };
};

describe('the geo endpoints', () => {
  it('are public reads that are cursor-paginated, and a consumer-only, keyed request', () => {
    for (const endpoint of [listStates, listStateCities, searchCities, getCity]) {
      expect(endpoint.method).toBe('get');
      expect(endpoint.scope).toBe('PUBLIC');
    }
    for (const endpoint of [listStates, listStateCities, searchCities]) {
      expect(endpoint.paginated).toBe('cursor');
    }
    expect(submitCityRequest).toMatchObject({ method: 'post', scope: 'CONSUMER', retryable: true });
  });

  it('asks for the largest page and walks every cursor to the end', async () => {
    const { fetch, urls } = pagedFetch([
      { items: [state(1), state(2)], nextCursor: 'c1' },
      { items: [state(3)], nextCursor: null },
    ]);
    const client = createApiClient({ baseUrl: 'https://api.test/v1', fetch });
    const states = await fetchAllStates(client);
    expect(states.map((s) => s.name)).toEqual(['State 1', 'State 2', 'State 3']);
    expect(urls).toEqual([
      `https://api.test/v1/geo/states?limit=${GEO_PAGE_LIMIT}`,
      `https://api.test/v1/geo/states?limit=${GEO_PAGE_LIMIT}&cursor=c1`,
    ]);
  });

  it('puts the state in the path for a state’s cities', async () => {
    const { fetch, urls } = pagedFetch([{ items: [city(1)], nextCursor: null }]);
    const client = createApiClient({ baseUrl: 'https://api.test/v1', fetch });
    expect(await fetchAllCities(client, id(7))).toHaveLength(1);
    expect(urls[0]).toBe(`https://api.test/v1/geo/states/${id(7)}/cities?limit=${GEO_PAGE_LIMIT}`);
  });

  it('sends the typeahead query', async () => {
    const { fetch, urls } = pagedFetch([{ items: [{ ...city(1), stateName: 'Lagos' }], nextCursor: null }]);
    const client = createApiClient({ baseUrl: 'https://api.test/v1', fetch });
    const page = await client.call(searchCities, { query: { q: 'ik', stateId: id(1), limit: 10 } });
    expect(page.items[0]?.stateName).toBe('Lagos');
    expect(urls[0]).toBe(`https://api.test/v1/geo/cities?q=ik&stateId=${id(1)}&limit=10`);
  });

  it('refuses a response that is not a page of states', async () => {
    const { fetch } = pagedFetch([{ items: [{ id: 'nope' }], nextCursor: null }]);
    const client = createApiClient({ baseUrl: 'https://api.test/v1', fetch });
    await expect(fetchAllStates(client)).rejects.toThrow();
  });
});
