// @vitest-environment jsdom
import type * as AppKit from '@komtru/app-kit';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../src/shell/Providers';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('../src/shell/ServiceWorker', () => ({ clearOfflineCache: () => Promise.resolve() }));
vi.mock('@komtru/app-kit', async (original) => ({
  ...(await original<typeof AppKit>()),
  readAppConfig: () => ({ apiUrl: 'https://api.test/v1', socketUrl: 'https://api.test' }),
}));

const provided = vi.hoisted(() => ({
  props: undefined as { onSessionEnded?: () => void; queryClient?: unknown } | undefined,
}));
vi.mock('@komtru/app-kit/react', () => ({
  createKomtruQueryClient: () => makeClient(),
  KomtruProviders: (props: {
    children: React.ReactNode;
    onSessionEnded?: () => void;
    queryClient?: unknown;
  }) => {
    provided.props = props;
    return props.children;
  },
}));
const clients: QueryClient[] = [];
function makeClient(): QueryClient {
  const client = new QueryClient();
  clients.push(client);
  return client;
}

beforeEach(() => {
  router.replace.mockReset();
  provided.props = undefined;
  clients.length = 0;
});
afterEach(cleanup);

describe('when a session ends', () => {
  it("empties the in-memory query cache, so the next person is not handed the last one's trades, then explains the sign-out (SP-M16)", async () => {
    render(
      <Providers>
        <p>app</p>
      </Providers>,
    );
    const client = clients[0];
    expect(client).toBeDefined();
    client?.setQueryData(['trades', 'trade-a'], { id: 'trade-a' });
    expect(provided.props?.queryClient).toBe(client);

    provided.props?.onSessionEnded?.();

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/session-expired?next=%2F');
    });
    expect(client?.getQueryData(['trades', 'trade-a'])).toBeUndefined();
  });
});
