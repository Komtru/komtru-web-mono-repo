import { describe, expect, it, vi } from 'vitest';
import {
  MAX_ADDRESSES_PER_USER,
  archiveAddress,
  createAddress,
  fetchAllAddresses,
  listAddresses,
  makeDefaultAddress,
  updateAddress,
} from '../src/addresses.js';
import { createApiClient } from '../src/client.js';

const id = (n: number) => `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const address = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(n),
  label: `Address ${n}`,
  recipientName: 'Ada Obi',
  recipientPhone: '+2348012345678',
  streetLine: '12 Allen Avenue',
  landmark: null,
  stateId: id(1),
  stateName: 'Lagos',
  cityId: id(2),
  cityName: 'Ikeja',
  cityActive: true,
  isDefault: n === 1,
  archivedAt: null,
  createdAt: '2026-11-06T10:00:00.000Z',
  updatedAt: '2026-11-06T10:00:00.000Z',
  ...over,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const recording = (respond: (n: number) => Response) => {
  const calls: { url: string; method: string; headers: Headers; body: string | null }[] = [];
  const fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
    });
    return Promise.resolve(respond(calls.length));
  });
  return { calls, client: createApiClient({ baseUrl: 'https://api.test/v1', fetch }) };
};

describe('the address endpoints', () => {
  it('are consumer-scoped, with only the create keyed for retries', () => {
    for (const endpoint of [
      listAddresses,
      createAddress,
      updateAddress,
      archiveAddress,
      makeDefaultAddress,
    ]) {
      expect(endpoint.scope).toBe('CONSUMER');
    }
    expect(listAddresses).toMatchObject({ method: 'get', paginated: 'cursor' });
    expect(createAddress).toMatchObject({ method: 'post', retryable: true });
    expect(updateAddress).toMatchObject({ method: 'patch', retryable: false });
    expect(archiveAddress).toMatchObject({ method: 'post', retryable: false });
    expect(makeDefaultAddress).toMatchObject({ method: 'post', retryable: false });
  });

  it('puts the id in the path for edit, archive and make-default', async () => {
    const { calls, client } = recording(() => json(address(3)));
    await client.call(updateAddress, { params: { id: id(3) }, body: { label: 'Work' } });
    await client.call(archiveAddress, { params: { id: id(3) } });
    await client.call(makeDefaultAddress, { params: { id: id(3) } });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `PATCH https://api.test/v1/me/addresses/${id(3)}`,
      `POST https://api.test/v1/me/addresses/${id(3)}/archive`,
      `POST https://api.test/v1/me/addresses/${id(3)}/default`,
    ]);
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ label: 'Work' });
  });

  it('sends an Idempotency-Key on create and none on the idempotent calls', async () => {
    const { calls, client } = recording(() => json(address(1)));
    await client.call(createAddress, {
      body: {
        label: 'Home',
        recipientName: 'Ada Obi',
        recipientPhone: '08012345678',
        streetLine: '12 Allen Avenue',
        landmark: null,
        stateId: id(1),
        cityId: id(2),
      },
    });
    await client.call(archiveAddress, { params: { id: id(1) } });
    expect(calls[0]?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(calls[1]?.headers.get('Idempotency-Key')).toBeNull();
  });

  it('asks for a page as large as the cap and walks every cursor', async () => {
    const { calls, client } = recording((n) =>
      n === 1
        ? json({ items: [address(1), address(2)], nextCursor: 'c1' })
        : json({ items: [address(3)], nextCursor: null }),
    );
    const all = await fetchAllAddresses(client);
    expect(all.map((a) => a.id)).toEqual([id(1), id(2), id(3)]);
    expect(calls.map((c) => c.url)).toEqual([
      `https://api.test/v1/me/addresses?limit=${MAX_ADDRESSES_PER_USER}`,
      `https://api.test/v1/me/addresses?limit=${MAX_ADDRESSES_PER_USER}&cursor=c1`,
    ]);
  });

  it('refuses a response that is not an address', async () => {
    const { client } = recording(() => json({ id: 'nope' }));
    await expect(client.call(makeDefaultAddress, { params: { id: id(1) } })).rejects.toThrow();
  });
});
