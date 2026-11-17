// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../src/client.js';
import { ApiClientProvider } from '../../src/react/client-context.js';
import {
  addressKeys,
  useAddresses,
  useArchiveAddress,
  useCreateAddress,
  useMakeDefaultAddress,
  useUpdateAddress,
} from '../../src/react/addresses.js';

const id = (n: number) => `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const address = (n: number, isDefault: boolean) => ({
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
  isDefault,
  archivedAt: null,
  createdAt: '2026-11-06T10:00:00.000Z',
  updatedAt: '2026-11-06T10:00:00.000Z',
});
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const setup = () => {
  const requests: string[] = [];
  let defaultId = 1;
  const fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    requests.push(`${method} ${new URL(url).pathname}`);
    if (method === 'GET') {
      return Promise.resolve(
        json({ items: [address(1, defaultId === 1), address(2, defaultId === 2)], nextCursor: null }),
      );
    }
    if (url.endsWith('/default')) defaultId = 2;
    return Promise.resolve(json(address(2, true)));
  });
  const client = createApiClient({ baseUrl: 'https://api.test/v1', fetch });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  return { Wrapper, queryClient, requests };
};

afterEach(cleanup);

function List() {
  const { data } = useAddresses();
  return <p data-testid="list">{(data ?? []).map((a) => `${a.label}${a.isDefault ? '*' : ''}`).join(',')}</p>;
}

function Actions() {
  const create = useCreateAddress();
  const update = useUpdateAddress();
  const archive = useArchiveAddress();
  const makeDefault = useMakeDefaultAddress();
  return (
    <div>
      <button
        onClick={() =>
          create.mutate({
            label: 'New',
            recipientName: 'Ada Obi',
            recipientPhone: '08012345678',
            streetLine: '1 Road',
            landmark: null,
            stateId: id(1),
            cityId: id(2),
          })
        }
      >
        create
      </button>
      <button onClick={() => update.mutate({ id: id(2), label: 'Renamed' })}>update</button>
      <button onClick={() => archive.mutate(id(2))}>archive</button>
      <button onClick={() => makeDefault.mutate(id(2))}>default</button>
    </div>
  );
}

describe('useAddresses', () => {
  it('loads the list into the cache under addressKeys.all', async () => {
    const { Wrapper, queryClient } = setup();
    render(<List />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('list').textContent).toBe('Address 1*,Address 2'));
    expect(queryClient.getQueryData(addressKeys.all)).toHaveLength(2);
  });
});

describe('the address mutations', () => {
  it.each([
    ['create', 'POST /v1/me/addresses'],
    ['update', `PATCH /v1/me/addresses/${id(2)}`],
    ['archive', `POST /v1/me/addresses/${id(2)}/archive`],
  ])('%s calls the endpoint and refreshes the list', async (button, expected) => {
    const { Wrapper, requests } = setup();
    render(
      <>
        <List />
        <Actions />
      </>,
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(screen.getByTestId('list').textContent).not.toBe(''));
    act(() => screen.getByText(button).click());
    await waitFor(() => expect(requests).toContain(expected));
    await waitFor(() => expect(requests.filter((r) => r.startsWith('GET'))).toHaveLength(2));
  });

  it('shows the moved default after make-default', async () => {
    const { Wrapper } = setup();
    render(
      <>
        <List />
        <Actions />
      </>,
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(screen.getByTestId('list').textContent).toBe('Address 1*,Address 2'));
    act(() => screen.getByText('default').click());
    await waitFor(() => expect(screen.getByTestId('list').textContent).toBe('Address 1,Address 2*'));
  });
});

describe('an address is PII', () => {
  it.each([
    [
      'create',
      () => useCreateAddress(),
      {
        label: 'Home',
        recipientName: 'Ada Obi',
        recipientPhone: '08012345678',
        streetLine: '1 Road',
        landmark: null,
        stateId: id(1),
        cityId: id(2),
      },
    ],
    ['update', () => useUpdateAddress(), { id: id(2), recipientPhone: '08012345678' }],
    ['archive', () => useArchiveAddress(), id(2)],
    ['make default', () => useMakeDefaultAddress(), id(2)],
  ] as const)(
    '%s leaves nothing in the mutation cache once the screen is gone',
    async (_name, hook, variables) => {
      const { Wrapper, queryClient } = setup();
      const rendered = renderHook(hook as () => { mutateAsync: (v: never) => Promise<unknown> }, {
        wrapper: Wrapper,
      });
      await act(async () => {
        await rendered.result.current.mutateAsync(variables as never);
      });
      rendered.unmount();
      // TanStack keeps `variables` and `data` for gcTime (5 minutes by default); `gcTime: 0` collects on the next tick.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(queryClient.getMutationCache().getAll()).toEqual([]);
    },
  );
});
