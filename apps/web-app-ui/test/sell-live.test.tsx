// @vitest-environment jsdom
// T-121 (SO5): "Your Shop Is Live". Shown once operations have approved the application.
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

describe('Your shop is live (SO5)', () => {
  it('says the shop is live, what it sells and that it is a Verified Merchant', async () => {
    answerWith(api.call, {
      'GET /merchant/applications/me': approved,
      'GET /config/trade-standards': standardsPage(),
    });
    const { container } = renderWithApi(api.call, <SellLive />);
    expect(await screen.findByRole('heading', { name: 'Your shop is live' })).toBeDefined();
    expect(screen.getByText(/Electronics · Verified Merchant/)).toBeDefined();
    expect(screen.getByText(/Trade Standards for this category now apply automatically/)).toBeDefined();
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
    expect(await screen.findByText('Your shop isn’t live yet')).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Your shop is live' })).toBeNull();
    expect(screen.getByRole('link', { name: 'See your application’s status' }).getAttribute('href')).toBe(
      '/shop/verification',
    );
  });

  it('shows an empty state when there is no application at all', async () => {
    answerWith(api.call, {
      'GET /merchant/applications/me': null,
      'GET /config/trade-standards': standardsPage(),
    });
    renderWithApi(api.call, <SellLive />);
    expect(await screen.findByText('Your shop isn’t live yet')).toBeDefined();
  });

  it('shows a loading state, and a load failure with a retry', async () => {
    answerWith(api.call, {
      'GET /merchant/applications/me': problem('INTERNAL', 500),
      'GET /config/trade-standards': standardsPage(),
    });
    renderWithApi(api.call, <SellLive />);
    expect(await screen.findByText('Couldn’t load your shop')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });
});
