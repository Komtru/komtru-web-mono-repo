// @vitest-environment jsdom
// F-045 (AS1, AS2): the suspended account, buyer and seller.
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Suspended } from '../src/account/Suspended';
import { expectNoAxeViolations } from './axe';
import { me } from './support/account';
import { SHELL_RULES, answerWith, renderWithApi, type CallFn } from './support/trade';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const suspended = (abilities: Record<string, boolean> = {}) =>
  me({
    status: 'SUSPENDED',
    noticeKey: 'ACCOUNT_SUSPENDED',
    abilities: { login: true, browse: true, buy: false, sell: false, withdraw: true, ...abilities },
  });

describe('Account suspended (AS1)', () => {
  it('says what happened, what is still protected and what happens next, in the reference’s words', async () => {
    answerWith(api.call, { 'GET /me': suspended() });
    const { container } = renderWithApi(api.call, <Suspended />);
    expect(await screen.findByRole('heading', { name: 'Your account is suspended' })).toBeDefined();
    expect(screen.getByText(/You can’t start new Trades right now/)).toBeDefined();
    expect(screen.getByText('What’s still protected')).toBeDefined();
    expect(screen.getByText(/funds in escrow remain protected/)).toBeDefined();
    expect(screen.getByText('A TrustOps specialist is looking into this')).toBeDefined();
    expect(screen.getByText('Within 48 hours')).toBeDefined();
    expect(screen.getByText('The moment a decision is made, with the reason')).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('shows the reference to quote to support, and not the staff reason, which is never sent', async () => {
    answerWith(api.call, { 'GET /me': suspended() });
    renderWithApi(api.call, <Suspended />);
    const button = await screen.findByRole('button', { name: 'Contact TrustOps about this' });
    expect(screen.queryByText('SUP-7KQ2')).toBeNull();
    fireEvent.click(button);
    expect(screen.getByText('SUP-7KQ2')).toBeDefined();
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('words a restricted or locked account as what it is', async () => {
    answerWith(api.call, { 'GET /me': me({ status: 'LOCKED' }) });
    renderWithApi(api.call, <Suspended />);
    expect(await screen.findByRole('heading', { name: 'Your account is locked' })).toBeDefined();
  });

  it('has nothing to say to an account in good standing, and points home', async () => {
    answerWith(api.call, { 'GET /me': me() });
    renderWithApi(api.call, <Suspended />);
    expect(await screen.findByText('Nothing is holding your account')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Back home' }).getAttribute('href')).toBe('/home');
  });

  it('shows loading, then an error with a retry, then offline', async () => {
    answerWith(api.call, { 'GET /me': new Error('down') });
    renderWithApi(api.call, <Suspended />);
    expect(screen.getByRole('status', { name: 'Checking your account' })).toBeDefined();
    expect(await screen.findByText('Couldn’t load your account')).toBeDefined();
    cleanup();
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    renderWithApi(api.call, <Suspended />);
    expect(await screen.findByText('You’re offline')).toBeDefined();
    online.mockRestore();
  });
});

describe('Shop suspended (AS2)', () => {
  it('says the shop is paused and what still works, from what the platform says the person can do', async () => {
    answerWith(api.call, { 'GET /me': suspended() });
    const { container } = renderWithApi(api.call, <Suspended seller />);
    expect(await screen.findByRole('heading', { name: 'Your shop is suspended' })).toBeDefined();
    expect(screen.getByText(/Existing Trades continue normally/)).toBeDefined();
    expect(screen.getByText('While this is under review, you can’t')).toBeDefined();
    expect(screen.getAllByText('Paused')).toHaveLength(2);
    expect(screen.getByText('Unaffected')).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says withdrawals are paused too when the platform has paused them', async () => {
    answerWith(api.call, { 'GET /me': suspended({ withdraw: false }) });
    renderWithApi(api.call, <Suspended seller />);
    expect(await screen.findAllByText('Paused')).toHaveLength(3);
    expect(screen.queryByText('Unaffected')).toBeNull();
  });

  it('points an account in good standing back to the shop', async () => {
    answerWith(api.call, { 'GET /me': me() });
    renderWithApi(api.call, <Suspended seller />);
    expect((await screen.findByRole('link', { name: 'Back to your shop' })).getAttribute('href')).toBe(
      '/shop',
    );
  });
});
