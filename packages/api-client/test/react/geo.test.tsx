// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../src/client.js';
import { ApiClientProvider, useApiClient } from '../../src/react/client-context.js';
import { geoKeys, useCities, useStates, useSubmitCityRequest } from '../../src/react/geo.js';

const id = (n: number) => `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const fakeApi = () => {
  const urls: string[] = [];
  const fetch = vi.fn((input: URL | RequestInfo) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    if (url.includes('/cities')) {
      const stateId = /states\/([^/]+)\/cities/.exec(url)?.[1] ?? '';
      return Promise.resolve(
        json({
          items: [{ id: id(900), stateId, name: `City of ${stateId.slice(-2)}`, active: true }],
          nextCursor: null,
        }),
      );
    }
    return Promise.resolve(
      url.includes('cursor=')
        ? json({ items: [{ id: id(2), code: 'OG', name: 'Ogun' }], nextCursor: null })
        : json({ items: [{ id: id(1), code: 'LA', name: 'Lagos' }], nextCursor: 'next' }),
    );
  });
  return {
    client: createApiClient({
      baseUrl: 'https://api.test/v1',
      fetch: fetch,
    }),
    urls,
  };
};

const wrap = (client: ReturnType<typeof fakeApi>['client']) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  return { Wrapper, queryClient };
};

function States() {
  const { data, isPending } = useStates();
  return <p data-testid="states">{isPending ? 'loading' : (data ?? []).map((s) => s.name).join(',')}</p>;
}

function Cities({ stateId }: { stateId: string | null }) {
  const { data, fetchStatus } = useCities(stateId);
  return (
    <p data-testid="cities">
      {fetchStatus}:{(data ?? []).map((c) => c.name).join(',')}
    </p>
  );
}

afterEach(cleanup);

describe('useStates', () => {
  it('returns every state across pages as one flat list', async () => {
    const { client, urls } = fakeApi();
    const { Wrapper, queryClient } = wrap(client);
    render(<States />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('states').textContent).toBe('Lagos,Ogun'));
    expect(urls).toHaveLength(2);
    expect(queryClient.getQueryData(geoKeys.states)).toHaveLength(2);
  });
});

describe('useCities', () => {
  it('stays idle until a state is chosen, then loads that state’s cities', async () => {
    const { client, urls } = fakeApi();
    const { Wrapper } = wrap(client);
    const view = render(<Cities stateId={null} />, { wrapper: Wrapper });
    expect(screen.getByTestId('cities').textContent).toBe('idle:');
    expect(urls).toEqual([]);

    view.rerender(<Cities stateId={id(1)} />);
    await waitFor(() => expect(screen.getByTestId('cities').textContent).toBe('idle:City of 01'));
    expect(urls).toHaveLength(1);
  });

  it('keys by state, so switching state never shows the previous state’s cities', async () => {
    const { client } = fakeApi();
    const { Wrapper } = wrap(client);
    const view = render(<Cities stateId={id(1)} />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('cities').textContent).toBe('idle:City of 01'));
    view.rerender(<Cities stateId={id(2)} />);
    await waitFor(() => expect(screen.getByTestId('cities').textContent).toBe('idle:City of 02'));
    expect(geoKeys.cities(id(1))).not.toEqual(geoKeys.cities(id(2)));
  });
});

describe('useApiClient', () => {
  it('says what is missing when there is no provider', () => {
    function Bare() {
      useApiClient();
      return null;
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Bare />)).toThrow('<ApiClientProvider>');
    spy.mockRestore();
  });
});

describe('useSubmitCityRequest', () => {
  it('posts the state and the city name', async () => {
    const calls: { url: string; body: string }[] = [];
    const fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : '' });
      return Promise.resolve(
        json({
          id: id(5),
          stateId: id(1),
          cityName: 'Epe',
          status: 'PENDING',
          resolvedCityId: null,
          decisionReason: null,
          createdAt: '2026-11-17T10:00:00.000Z',
          decidedAt: null,
        }),
      );
    });
    const client = createApiClient({ baseUrl: 'https://api.test/v1', fetch });
    const { Wrapper } = wrap(client);
    const { result } = renderHook(() => useSubmitCityRequest(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ stateId: id(1), cityName: 'Epe' });
    });
    expect(calls[0]?.url).toBe('https://api.test/v1/geo/city-requests');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ stateId: id(1), cityName: 'Epe' });
  });
});
