// @vitest-environment jsdom
// F-044: a system state nothing routes to is not shipped. Each of SP-M14 to SP-M19 is reached here by the condition that
// should trigger it, through the real screen that meets the condition.
import { ProblemError } from '@komtru/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTRY_PATHS, PUBLIC_PATHS } from '../src/middleware-rules';
import { safeNext, sessionExpiredHref } from '../src/entry/flow';
import { SystemWatcher } from '../src/system/SystemWatcher';
import { TradeByCode } from '../src/trade/TradeByCode';
import { TradeDocuments } from '../src/trade/documents/TradeDocuments';
import { expectNoAxeViolations } from './axe';
import { me, problem } from './support/account';
import { SHELL_RULES, answerWith, id, renderWithApi, type CallFn } from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

beforeEach(() => {
  api.call.mockReset();
  router.replace.mockReset();
});
afterEach(cleanup);

describe('SP-M16 session expired: reached when a refresh says the session is over', () => {
  it('carries the screen the person was on, and nothing that cannot be returned to', () => {
    expect(sessionExpiredHref('/trades/KMT-1-NG?tab=terms')).toBe(
      '/session-expired?next=%2Ftrades%2FKMT-1-NG%3Ftab%3Dterms',
    );
    expect(sessionExpiredHref('/login')).toBe('/session-expired');
    expect(sessionExpiredHref('/session-expired?next=%2Fhome')).toBe('/session-expired');
    expect(sessionExpiredHref('//evil.example')).toBe('/session-expired');
    expect(safeNext('/session-expired')).toBeUndefined();
  });

  it('is a page anyone can open, so the explanation is not itself behind the sign-in it explains', () => {
    for (const path of ['/session-expired', '/status', '/update-required']) {
      expect(ENTRY_PATHS as readonly string[]).toContain(path);
      expect(PUBLIC_PATHS as readonly string[]).not.toContain(path);
    }
  });
});

describe('SP-M19 link expired or Trade not found: reached by a 404 on a trade', () => {
  it('replaces the dead end on a Trade Code that opens nothing, and does not offer to retry it', async () => {
    answerWith(api.call, { 'GET /trades/by-code/:code': problem('NOT_FOUND', 404), 'GET /me': me() });
    const { container } = renderWithApi(api.call, <TradeByCode typed="KMT-9042800-NG" />);
    expect(await screen.findByRole('heading', { name: 'We can’t find that Trade' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('is what a trade screen says when the trade is not there', async () => {
    answerWith(api.call, { 'GET /trades/:id': problem('NOT_FOUND', 404), 'GET /me': me() });
    renderWithApi(api.call, <TradeDocuments id={id(1)} />);
    expect(await screen.findByRole('heading', { name: 'We can’t find that Trade' })).toBeDefined();
  });

  it('is not what a failed read is: a 500 is still a retryable error, not a missing trade', async () => {
    answerWith(api.call, { 'GET /trades/:id': problem('INTERNAL', 500) });
    renderWithApi(api.call, <TradeDocuments id={id(1)} />);
    expect(await screen.findByText('Couldn’t load this trade')).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'We can’t find that Trade' })).toBeNull();
  });
});

const meta = { requestId: undefined, retryAfterMs: undefined, rateLimit: undefined, replayed: false };
const failure = (status: number, code = 'X') =>
  new ProblemError({ type: 'about:blank', title: 'x', status, code }, { status, ...meta }, false);

function watcher() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SystemWatcher />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe('SP-M14 service notice: reached by a 503 from any read or change', () => {
  it('says so in the shell, links to the notice, and goes when the platform answers again', async () => {
    const queries = watcher();
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => {
      await queries
        .fetchQuery({ queryKey: ['a'], queryFn: () => Promise.reject(failure(503)) })
        .catch(() => undefined);
    });
    expect(await screen.findByText('Komtru is having trouble')).toBeDefined();
    expect(screen.getByRole('link', { name: 'See what’s happening' }).getAttribute('href')).toBe('/status');
    expect(router.replace).not.toHaveBeenCalled();
    await act(async () => {
      await queries.fetchQuery({ queryKey: ['b'], queryFn: () => Promise.resolve(1) });
    });
    await waitFor(() => expect(screen.queryByText('Komtru is having trouble')).toBeNull());
  });

  it('hears a change that fails the same way, not only a read', async () => {
    const queries = watcher();
    await act(async () => {
      await queries
        .getMutationCache()
        .build(queries, { mutationFn: () => Promise.reject(failure(503)) })
        .execute(undefined)
        .catch(() => undefined);
    });
    expect(await screen.findByText('Komtru is having trouble')).toBeDefined();
  });

  it('says nothing for the failures that are not an outage', async () => {
    const queries = watcher();
    for (const status of [400, 404, 429, 500]) {
      await act(async () => {
        await queries
          .fetchQuery({ queryKey: ['s', status], queryFn: () => Promise.reject(failure(status)) })
          .catch(() => undefined);
      });
    }
    expect(screen.queryByText('Komtru is having trouble')).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('SP-M15 update required: reached by a 426', () => {
  it('sends the person to the update screen', async () => {
    const queries = watcher();
    await act(async () => {
      await queries
        .fetchQuery({ queryKey: ['v'], queryFn: () => Promise.reject(failure(426)) })
        .catch(() => undefined);
    });
    expect(router.replace).toHaveBeenCalledWith('/update-required');
  });
});
