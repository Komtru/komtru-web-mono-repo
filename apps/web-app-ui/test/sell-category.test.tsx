// @vitest-environment jsdom
// T-121 (SO2): "What Do You Sell?", the category that sets the Trade Standards on every listing.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SellCategory } from '../src/sell/Category';
import { expectNoAxeViolations } from './axe';
import { problem } from './support/account';
import { SHELL_RULES, answerWith, callsTo, renderWithApi, standardsPage, type CallFn } from './support/trade';
import { application } from './support/merchant';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push, replace: nav.push }) }));

const base = {
  'GET /config/trade-standards': standardsPage(),
  'GET /merchant/applications/me': application(),
};

beforeEach(() => {
  api.call.mockReset();
  nav.push.mockReset();
});
afterEach(cleanup);

describe('What do you sell? (SO2)', () => {
  it('draws one tile per category, with the inspection window the standard sets', async () => {
    answerWith(api.call, base);
    const { container } = renderWithApi(api.call, <SellCategory />);
    expect(await screen.findByRole('button', { name: /Electronics/ })).toBeDefined();
    expect(screen.getByText('48h inspection standard')).toBeDefined();
    expect(screen.getByText('24h inspection standard')).toBeDefined();
    expect(screen.getByText('2 / 5')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Continue to verification' })).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('marks the chosen categories as pressed and keeps Continue disabled until one is chosen', async () => {
    answerWith(api.call, base);
    renderWithApi(api.call, <SellCategory />);
    const electronics = await screen.findByRole('button', { name: /Electronics/ });
    const cont = screen.getByRole<HTMLButtonElement>('button', { name: 'Continue to verification' });
    expect(cont.disabled).toBe(true);
    fireEvent.click(electronics);
    expect(electronics.getAttribute('aria-pressed')).toBe('true');
    expect(cont.disabled).toBe(false);
    fireEvent.click(electronics);
    expect(electronics.getAttribute('aria-pressed')).toBe('false');
    expect(cont.disabled).toBe(true);
  });

  it('can hold more than one category', async () => {
    answerWith(api.call, base);
    renderWithApi(api.call, <SellCategory />);
    fireEvent.click(await screen.findByRole('button', { name: /Electronics/ }));
    fireEvent.click(screen.getByRole('button', { name: /Fashion & Luxury/ }));
    expect(screen.getByRole('button', { name: /Fashion & Luxury/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('saves the categories by their codes and moves on to verification', async () => {
    answerWith(api.call, {
      ...base,
      'PUT /merchant/applications/me': application({ form: { categories: ['electronics'] } }),
    });
    renderWithApi(api.call, <SellCategory />);
    fireEvent.click(await screen.findByRole('button', { name: /Electronics/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to verification' }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/sell/verify-business'));
    expect(callsTo(api.call, 'PUT', '/merchant/applications/me')[0]?.body).toEqual({
      categories: ['electronics'],
    });
  });

  it('shows the chosen categories when the person comes back', async () => {
    answerWith(api.call, {
      ...base,
      'GET /merchant/applications/me': application({ form: { categories: ['fashion'] } }),
    });
    renderWithApi(api.call, <SellCategory />);
    expect(
      (await screen.findByRole('button', { name: /Fashion & Luxury/ })).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('shows a loading state, and a load failure with a retry when the standards do not load', async () => {
    answerWith(api.call, { ...base, 'GET /config/trade-standards': problem('INTERNAL', 500) });
    renderWithApi(api.call, <SellCategory />);
    expect(await screen.findByText('Couldn’t load the categories')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });

  it('says so when no categories are set up yet', async () => {
    answerWith(api.call, { ...base, 'GET /config/trade-standards': standardsPage([]) });
    renderWithApi(api.call, <SellCategory />);
    expect(await screen.findByText('No categories are open to sell yet')).toBeDefined();
  });
});
