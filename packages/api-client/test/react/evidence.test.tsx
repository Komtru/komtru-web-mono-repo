// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../src/client.js';
import { ApiClientProvider } from '../../src/react/client-context.js';
import { evidenceKeys, useAttachEvidence, useTradeEvidence } from '../../src/react/evidence.js';

const ID = '0190b0a0-0000-7000-8000-000000000001';
const FILE = '0190b0a0-0000-7000-8000-000000000005';
const item = {
  id: '0190b0a0-0000-7000-8000-000000000009',
  fileId: FILE,
  event: 'DELIVERY',
  attachedByRole: 'SELLER',
  attachedAt: '2026-11-17T09:00:00.000Z',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(cleanup);

function setup(respond: (method: string) => Response) {
  const requests: string[] = [];
  const fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push(`${init?.method ?? 'GET'} ${url.replace('https://api.test/v1', '')}`);
    return Promise.resolve(respond(init?.method ?? 'GET'));
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = createApiClient({ baseUrl: 'https://api.test/v1', fetch });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={client}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  return { requests, queryClient, wrapper };
}

describe('the evidence hooks', () => {
  it('read one event’s media, and stay idle until enabled', async () => {
    const { requests, wrapper: Wrapper } = setup(() => json({ items: [item], nextCursor: null }));
    function Probe({ on }: { on: boolean }) {
      const query = useTradeEvidence(ID, 'DELIVERY', on);
      return <p>{query.data ? `${String(query.data.items.length)} file` : 'waiting'}</p>;
    }
    const view = render(<Probe on={false} />, { wrapper: Wrapper });
    expect(requests).toEqual([]);
    view.rerender(<Probe on />);
    expect(await screen.findByText('1 file')).toBeTruthy();
    expect(requests).toEqual([`GET /trades/${ID}/evidence?event=DELIVERY&limit=40`]);
  });

  it('refetch the trade’s evidence after an attach', async () => {
    const {
      requests,
      queryClient,
      wrapper: Wrapper,
    } = setup((method) =>
      method === 'POST' ? json({ evidence: [item] }, 201) : json({ items: [item], nextCursor: null }),
    );
    await queryClient.prefetchQuery({
      queryKey: evidenceKeys.event(ID, 'DELIVERY'),
      queryFn: () => ({ items: [], nextCursor: null }),
    });
    function Probe() {
      const list = useTradeEvidence(ID, 'DELIVERY', true);
      const attach = useAttachEvidence();
      return (
        <>
          <p>{list.data ? String(list.data.items.length) : '-'}</p>
          <button
            type="button"
            onClick={() => {
              attach.mutate({ id: ID, event: 'DELIVERY', fileIds: [FILE] });
            }}
          >
            attach
          </button>
        </>
      );
    }
    render(<Probe />, { wrapper: Wrapper });
    screen.getByText('attach').click();
    await waitFor(() => {
      expect(requests).toContain(`POST /trades/${ID}/evidence`);
    });
    expect(await screen.findByText('1')).toBeTruthy();
  });
});
