// @vitest-environment jsdom
// TW-01: the trade is agreed and nobody has paid. Both people see the same record; only the buyer is led to fund.
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TradeScreen } from '../src/trade/TradeScreen';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  activityRow,
  answerWith,
  id,
  page,
  renderWithApi,
  workspaceTrade,
  type CallFn,
} from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const show = (role: 'BUYER' | 'SELLER') => {
  answerWith(api.call, {
    'GET /trades/:id': workspaceTrade('PENDING_PAYMENT', role),
    'GET /trades/:id/activity': page([activityRow(1)]),
  });
  return renderWithApi(api.call, <TradeScreen id={id(1)} />);
};

describe('TW-01 awaiting funding', () => {
  it('warns not to dispatch and lists the agreed terms with the payment status', async () => {
    show('BUYER');
    expect(await screen.findByText('Do not dispatch until payment is confirmed')).toBeTruthy();
    const terms = screen.getByLabelText('Agreed terms');
    expect(within(terms).getByText('Item price')).toBeTruthy();
    expect(within(terms).getByText('Delivery')).toBeTruthy();
    expect(within(terms).getByText(/Electronics · 48 hours/)).toBeTruthy();
    expect(within(terms).getByText('Not yet confirmed')).toBeTruthy();
  });

  it('does not claim a funding deadline the platform has not given', async () => {
    show('BUYER');
    await screen.findByText('Do not dispatch until payment is confirmed');
    expect(screen.queryByText(/remaining/)).toBeNull();
    expect(screen.queryByText(/six hours/i)).toBeNull();
  });

  it('leads the buyer to funding, withdrawing and the policies', async () => {
    show('BUYER');
    expect((await screen.findByRole('link', { name: 'Continue to funding' })).getAttribute('href')).toBe(
      `/trade/${id(1)}/fund`,
    );
    expect(screen.getByRole('link', { name: 'Withdraw from trade' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/actions`,
    );
    expect(screen.getByRole('link', { name: 'Trade policies' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/policies`,
    );
  });

  it('tells the seller to wait, with no way to fund', async () => {
    show('SELLER');
    expect(await screen.findByText(/for the buyer to fund the trade/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Continue to funding' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Withdraw from trade' })).toBeTruthy();
  });

  it('has no serious accessibility violations', async () => {
    const { container } = show('BUYER');
    await screen.findByText('Do not dispatch until payment is confirmed');
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});
