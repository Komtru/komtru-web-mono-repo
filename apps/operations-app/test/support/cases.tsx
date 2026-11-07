import type { CaseView } from '@komtru/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { Mock } from 'vitest';

export const id = (n: number): string => `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
export const ME = id(900);

export const caseRow = (n: number, over: Partial<CaseView> = {}): CaseView => ({
  id: id(n),
  caseNumber: n,
  code: `C-${String(n).padStart(6, '0')}`,
  type: 'TRADE_PROPOSAL',
  subjectType: 'TRADE',
  subjectId: `KMT-${90000 + n}`,
  title: `Case number ${n}`,
  state: 'OPEN',
  priority: 'NORMAL',
  ownerUserId: null,
  sla: {
    status: 'ON_TRACK',
    dueAt: '2026-11-08T10:00:00.000Z',
    remainingMinutes: 600,
    hours: 24,
    startedAt: '2026-11-07T10:00:00.000Z',
  },
  escalatedAt: null,
  decidedAt: null,
  closedAt: null,
  createdAt: '2026-11-07T08:00:00.000Z',
  updatedAt: '2026-11-07T08:00:00.000Z',
  ...over,
});

export const page = (items: CaseView[], nextCursor: string | null = null) => ({ items, nextCursor });

export const staff = (permissions: string[]) => ({
  user: { id: ME, publicId: 'U1', displayName: 'Amina Yusuf', username: null },
  roles: [{ code: 'OPERATIONS_ADMIN', name: 'Operations admin' }],
  permissions,
});

export const READ = ['cases.view'];
export const MANAGE = ['cases.view', 'cases.manage'];

type Handler = (input: {
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
}) => unknown;

/**
 * Makes a mocked `client.call` answer by "METHOD /path": a table of handlers. An endpoint with no
 * handler rejects, so a screen that calls something the test did not expect fails loudly.
 */
export function answerWith(call: Mock, handlers: Record<string, Handler | unknown>): void {
  call.mockImplementation(
    (endpoint: { method: string; path: string }, input: Parameters<Handler>[0] = {}) => {
      const key = `${endpoint.method.toUpperCase()} ${endpoint.path}`;
      if (!(key in handlers)) return Promise.reject(new Error(`no handler for ${key}`));
      const handler = handlers[key];
      return Promise.resolve(typeof handler === 'function' ? (handler as Handler)(input) : handler);
    },
  );
}

export const renderWithQuery = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>,
  );

// `ConsoleShell` hides each rail label below `lg` and `EmptyState` draws a fixed `h4` under the
// shell's `h1`; both are outside these screens, as in console-frame.test.tsx.
export const SHELL_RULES = ['label-content-name-mismatch', 'heading-order'];
