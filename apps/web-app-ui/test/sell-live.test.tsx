// @vitest-environment jsdom
// T-121 (SO5): the approved outcome. Shown once operations have approved the application.
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SellLive } from '../src/sell/Live';
import { expectNoAxeViolations } from './axe';
import { problem } from './support/account';
import { SHELL_RULES, answerWith, renderWithApi, standardsPage, type CallFn } from './support/trade';
import { application } from './support/merchant';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const approved = application({
  status: 'APPROVED',
  form: { businessName: 'TechEdge NG', categories: ['electronics'], cacRcNumber: 'RC 1487XXX' },
  decidedAt: '2026-11-19T08:00:00.000Z',
});

describe('Verified merchant (SO5)', () => {
  it('says the business is a verified merchant, what it sells, and where to go next', async () => {
    answerWith(api.call, {
      'GET /merchant/applications/me': approved,
      'GET /config/trade-standards': standardsPage(),
    });
    const { container } = renderWithApi(api.call, <SellLive />);
    expect(await screen.findByRole('heading', { name: 'You’re a verified merchant' })).toBeDefined();
    expect(screen.getByText(/Electronics · Verified Merchant/)).toBeDefined();
    expect(screen.getByText(/Trade Standards for this category apply automatically/)).toBeDefined();
    const action = screen.getByRole('link', { name: 'Go to your shop' });
    expect(action.getAttribute('href')).toBe('/shop');
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('is not shown before operations approve the application: it points to the status instead', async () => {
    answerWith(api.call, {
      'GET /merchant/applications/me': application({ status: 'IN_REVIEW' }),
      'GET /config/trade-standards': standardsPage(),
    });
    renderWithApi(api.call, <SellLive />);
    expect(await screen.findByText('You’re not a merchant yet')).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'You’re a verified merchant' })).toBeNull();
    expect(screen.getByRole('link', { name: 'See your verification' }).getAttribute('href')).toBe(
      '/account/verification/merchant',
    );
  });

  it('shows an empty state when there is no application at all', async () => {
    answerWith(api.call, {
      'GET /merchant/applications/me': null,
      'GET /config/trade-standards': standardsPage(),
    });
    renderWithApi(api.call, <SellLive />);
    expect(await screen.findByText('You’re not a merchant yet')).toBeDefined();
  });

  it('shows a loading state, and a load failure with a retry', async () => {
    answerWith(api.call, {
      'GET /merchant/applications/me': problem('INTERNAL', 500),
      'GET /config/trade-standards': standardsPage(),
    });
    renderWithApi(api.call, <SellLive />);
    expect(await screen.findByText('Couldn’t load your merchant status')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });
});
