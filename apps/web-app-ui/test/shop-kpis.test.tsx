// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShopKpis } from '../src/home/ShopKpis';
import { expectNoAxeViolations } from './axe';
import { summary } from './support/payouts';
import { answerWith, listItem, renderWithApi, type CallFn } from './support/trade';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const page = (items: unknown[]) => ({ items, nextCursor: null });

// F-083: DX-04's KPI strip, with only what the platform reports.
describe('the shop KPI strip', () => {
  const trades = [
    listItem(1, { yourRole: 'SELLER', status: 'FUNDED' }),
    listItem(2, { yourRole: 'SELLER', status: 'SHIPPED' }),
    listItem(3, { yourRole: 'SELLER', status: 'INSPECTION' }),
    listItem(4, { yourRole: 'BUYER', status: 'FUNDED' }),
  ];

  it('shows the payout balance and counts only the person’s own sales', async () => {
    answerWith(api.call, {
      'GET /me/payouts/summary': summary({ availableMinor: '120000000' }),
      'GET /trades': page(trades),
    });
    renderWithApi(api.call, <ShopKpis certifiedMerchant />);
    const strip = screen.getByRole('list', { name: 'Your shop at a glance' });
    expect(await within(strip).findByText('₦1,200,000')).toBeTruthy();
    const toShip = within(strip).getByRole('link', { name: /To ship/ });
    expect(await within(toShip).findByText('1')).toBeTruthy();
    expect(within(within(strip).getByRole('link', { name: /With the buyer/ })).getByText('2')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Get merchant status' })).toBeNull();
  });

  it('points an account without merchant status at merchant status', async () => {
    answerWith(api.call, { 'GET /me/payouts/summary': summary(), 'GET /trades': page([]) });
    const { container } = renderWithApi(api.call, <ShopKpis certifiedMerchant={false} />);
    expect((await screen.findByRole('link', { name: 'Get merchant status' })).getAttribute('href')).toBe(
      '/account/verification/merchant',
    );
    await expectNoAxeViolations(container);
  });

  it('shows a dash, not a spinner, when the balance cannot be read', async () => {
    api.call.mockImplementation((endpoint) =>
      (endpoint as { path: string }).path === '/me/payouts/summary'
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(page([])),
    );
    renderWithApi(api.call, <ShopKpis certifiedMerchant />);
    const available = screen.getByRole('link', { name: /Available/ });
    expect(await within(available).findByText('—', {}, { timeout: 4000 })).toBeTruthy();
  });
});
