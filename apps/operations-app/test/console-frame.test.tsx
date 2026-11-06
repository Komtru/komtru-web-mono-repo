// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyAccount } from '../src/components/MyAccount';
import { ConsoleFrame } from '../src/shell/ConsoleFrame';
import { SectionPage } from '../src/shell/SectionPage';
import { expectNoAxeViolations } from './axe';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

// `useApiClient` is the app-kit hook; the frame only needs a client that answers `GET /admin/me`.
const answer = vi.hoisted((): { me: unknown; fail: boolean } => ({ me: undefined, fail: false }));
vi.mock('@komtru/app-kit/react', () => ({
  useApiClient: () => ({
    call: () => (answer.fail ? Promise.reject(new Error('404')) : Promise.resolve(answer.me)),
  }),
}));

// Two rules the shell's own parts trip in jsdom, both outside this ticket's markup:
//   * `label-content-name-mismatch` — `ConsoleShell` hides each rail label below `lg` with a class
//     jsdom has no stylesheet for, so axe cannot compare the visible text with the accessible name
//     and leaves it in `incomplete`. The names are equal by construction (`aria-label={item.label}`).
//   * `heading-order` — `EmptyState` draws its title as a fixed `h4` under the shell's `h1`. That is
//     ui-kit's, and a finding for it, not for a section page that reuses it.
const SHELL_RULES = ['label-content-name-mismatch', 'heading-order'];

const staff = (permissions: string[], roles = [{ code: 'KYC_ANALYST', name: 'KYC analyst' }]) => ({
  user: {
    id: '0190b0a0-0000-7000-8000-000000000001',
    publicId: 'U1',
    displayName: 'Amina Yusuf',
    username: null,
  },
  roles,
  permissions,
});

const renderWith = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>,
  );

const railLabels = () =>
  within(screen.getByRole('navigation', { name: 'Console sections' }))
    .getAllByRole('link')
    .map((link) => link.getAttribute('aria-label'));

beforeEach(() => {
  answer.me = undefined;
  answer.fail = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ConsoleFrame', () => {
  it('shows only the sections the person holds a permission for', async () => {
    answer.me = staff(['verification.view', 'cases.view']);
    renderWith(<SectionPage id="identity" />);
    await waitFor(() => expect(railLabels()).toEqual(['Work Queue', 'Identity / KYB']));
    expect(screen.queryByRole('link', { name: 'Payments / Settlement' })).toBeNull();
  });

  it('marks the current section and draws its own page', async () => {
    answer.me = staff(['verification.view']);
    const { container } = renderWith(<SectionPage id="identity" />);
    const link = await screen.findByRole('link', { name: 'Identity / KYB' });
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { level: 1, name: 'Identity / KYB' })).toBeDefined();
    expect(screen.getByText('Nothing to show here yet')).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('draws nothing in the rail and nothing of the page before it knows who this is', () => {
    renderWith(<SectionPage id="queue" />);
    expect(screen.getByRole('status').textContent).toContain('Checking your access');
    expect(screen.queryByText('Nothing to show here yet')).toBeNull();
  });

  it('refuses a section the role does not include, even by a pasted URL', async () => {
    answer.me = staff(['verification.view']);
    renderWith(<SectionPage id="payments" />);
    expect(await screen.findByText('This section is not part of your role')).toBeDefined();
    expect(screen.queryByText('Nothing to show here yet')).toBeNull();
  });

  it('fails closed when the platform has no answer: an empty rail and a retry', async () => {
    answer.fail = true;
    renderWith(<SectionPage id="queue" />);
    expect(await screen.findByText('We could not check your access')).toBeDefined();
    expect(screen.queryAllByRole('link', { name: 'Work Queue' })).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });

  it('keeps My account and Sign out in the rail whatever the role', async () => {
    answer.me = staff([]);
    renderWith(
      <ConsoleFrame title="Anything">
        <p>Body</p>
      </ConsoleFrame>,
    );
    expect(await screen.findByText('Body')).toBeDefined();
    expect(screen.getByRole('link', { name: 'My account' }).getAttribute('href')).toBe('/me');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeDefined();
  });

  it('signs out through the route handler and goes to sign-in', async () => {
    answer.me = staff([]);
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetchMock);
    renderWith(
      <ConsoleFrame title="Anything">
        <p>Body</p>
      </ConsoleFrame>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/sign-in'));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
    vi.unstubAllGlobals();
  });
});

describe('MyAccount (OP-33)', () => {
  it('reads the role and permissions the platform returned', async () => {
    answer.me = staff(['verification.view', 'cases.view', 'made.up']);
    const { container } = renderWith(<MyAccount />);
    expect(await screen.findByText('Amina Yusuf · KYC analyst')).toBeDefined();
    expect(screen.getByRole('heading', { level: 1, name: 'My account' })).toBeDefined();
    expect(screen.getByText('On, for every sign-in')).toBeDefined();
    // The code the console does not know is not counted.
    const permissions = screen.getByText('Permissions').closest('div')!;
    expect(within(permissions).getByText('2')).toBeDefined();
    expect(screen.getByText('Work Queue, Identity / KYB')).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says so when the account did not load', async () => {
    answer.fail = true;
    renderWith(<MyAccount />);
    expect(await screen.findByText('We could not load your account')).toBeDefined();
  });
});
