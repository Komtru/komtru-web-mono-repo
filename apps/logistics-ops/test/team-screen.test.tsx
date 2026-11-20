// @vitest-environment jsdom
// T-161 on screen: the admin's invite form with its two success states, the roster's two pending
// kinds, LAST_ADMIN explained, and an operator shown no control they cannot use.
import { ProblemError } from '@komtru/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { TeamScreen } from '../src/team/TeamScreen';
import { expectNoAxeViolations } from './axe';

type Endpoint = { method: string; path: string };
type CallFn = (endpoint: Endpoint, input?: Record<string, unknown>) => Promise<unknown>;
const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
vi.mock('@komtru/app-kit/react', () => ({ useApiClient: () => api }));

const id = (n: number) => `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const paged = (items: unknown[]) => ({ items, page: 1, limit: 100, total: items.length });

const ME = {
  company: {
    id: id(1),
    name: 'Swift Couriers',
    status: 'ENABLED' as const,
    isDefault: false,
    createdAt: '2026-11-01T00:00:00.000Z',
  },
  member: { id: id(10), role: 'ADMIN' as const },
};

const member = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(n),
  name: `Person ${String(n)}`,
  contactMasked: `p•••${String(n)}@swift.ng`,
  role: 'OPERATOR',
  status: 'ACTIVE',
  invitedAt: '2026-11-20T09:00:00.000Z',
  acceptedAt: null,
  removedAt: null,
  ...over,
});

const MEMBERS = [
  member(10, { name: 'Ada Admin', role: 'ADMIN' }),
  member(11, { name: 'Obi Operator' }),
  member(12, { name: 'Ngozi Newcomer', status: 'INVITED' }),
];
const INVITATIONS = [
  {
    id: id(20),
    role: 'OPERATOR',
    channel: 'PHONE',
    contactMasked: '+23480•••4567',
    status: 'PENDING',
    invitedAt: '2026-11-20T09:00:00.000Z',
    expiresAt: '2026-11-27T09:00:00.000Z',
  },
];

const problem = (code: string) =>
  new ProblemError({ type: 'about:blank', status: 409, code, title: code }, {} as never, false);

function answer(call: Mock<CallFn>, handlers: Record<string, unknown>): void {
  call.mockImplementation((endpoint, input = {}) => {
    const key = `${endpoint.method.toUpperCase()} ${endpoint.path}`;
    if (!(key in handlers)) return Promise.reject(new Error(`no handler for ${key}`));
    const handler = handlers[key];
    return typeof handler === 'function'
      ? (handler as (input: Record<string, unknown>) => Promise<unknown>)(input)
      : Promise.resolve(handler);
  });
}

const serve = (extra: Record<string, unknown> = {}) =>
  answer(api.call, {
    'GET /logistics/members': paged(MEMBERS),
    'GET /logistics/invitations': paged(INVITATIONS),
    'GET /logistics/me': ME,
    ...extra,
  });

const renderScreen = (isAdmin = true) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TeamScreen
        me={{ ...ME, member: { ...ME.member, role: isAdmin ? 'ADMIN' : 'OPERATOR' } }}
        isAdmin={isAdmin}
      />
    </QueryClientProvider>,
  );

beforeEach(() => {
  api.call.mockReset();
});
afterEach(() => {
  cleanup();
});

describe('TeamScreen', () => {
  it('groups the roster into on the team, waiting to sign in and waiting to sign up', async () => {
    serve();
    const { container } = renderScreen();
    await screen.findByText('Obi Operator');
    expect(screen.getByText('On the team · 2')).toBeDefined();
    expect(screen.getByText('Waiting to sign in · 1')).toBeDefined();
    expect(screen.getByText('Waiting to sign up · 1')).toBeDefined();
    expect(screen.getByText('Not signed in yet')).toBeDefined();
    expect(screen.getByText('Not signed up yet')).toBeDefined();
    expect(screen.getByText('+23480•••4567')).toBeDefined();
    await expectNoAxeViolations(container);
  });

  it('shows "Added — they can log in now" for a LINKED invite', async () => {
    serve({
      'POST /logistics/members': {
        outcome: 'LINKED',
        member: member(13, { name: 'Tunde', status: 'INVITED' }),
      },
    });
    renderScreen();
    await screen.findByText('Obi Operator');
    fireEvent.change(screen.getByLabelText('Email or phone'), { target: { value: 'tunde@swift.ng' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(await screen.findByText('Added — Tunde can log in now')).toBeDefined();
    const [, input] = api.call.mock.calls.find(([endpoint]) => endpoint.method === 'post')!;
    expect(input).toEqual({ body: { email: 'tunde@swift.ng', role: 'OPERATOR' } });
  });

  it('shows "Pending — they get access once they sign up" for a PENDING invite', async () => {
    serve({ 'POST /logistics/members': { outcome: 'PENDING', invitation: INVITATIONS[0] } });
    renderScreen();
    await screen.findByText('Obi Operator');
    fireEvent.change(screen.getByLabelText('Email or phone'), { target: { value: '0803 123 4567' } });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'ADMIN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(
      await screen.findByText('Pending — they get access once they sign up with this email or phone'),
    ).toBeDefined();
    const [, input] = api.call.mock.calls.find(([endpoint]) => endpoint.method === 'post')!;
    expect(input).toEqual({ body: { phone: '0803 123 4567', role: 'ADMIN' } });
  });

  it('explains LAST_ADMIN as "Promote someone else first"', async () => {
    serve({ 'PATCH /logistics/members/:id': () => Promise.reject(problem('LAST_ADMIN')) });
    renderScreen();
    await screen.findByText('Ada Admin');
    fireEvent.click(screen.getAllByRole('button', { name: 'Make operator' })[0]!);
    expect(await screen.findByText('Promote someone else first')).toBeDefined();
  });

  it('asks before removing someone, then removes them', async () => {
    serve({ 'PATCH /logistics/members/:id': member(11, { status: 'REMOVED' }) });
    renderScreen();
    await screen.findByText('Obi Operator');
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Obi Operator' }));
    expect(await screen.findByText('Obi Operator was removed')).toBeDefined();
    const patch = api.call.mock.calls.find(([endpoint]) => endpoint.method === 'patch')!;
    expect(patch[1]).toEqual({ params: { id: id(11) }, body: { status: 'REMOVED' } });
  });

  it('hides every admin control from an operator', async () => {
    serve();
    const { container } = renderScreen(false);
    await screen.findByText('Obi Operator');
    expect(screen.queryByLabelText('Email or phone')).toBeNull();
    for (const name of ['Send invite', 'Make admin', 'Make operator', 'Remove', 'Withdraw']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.getByText('Only an admin can change the team')).toBeDefined();
    await waitFor(() =>
      expect(api.call.mock.calls.every(([endpoint]) => endpoint.method === 'get')).toBe(true),
    );
    await expectNoAxeViolations(container);
  });
});
