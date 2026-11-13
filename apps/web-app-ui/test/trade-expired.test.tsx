// @vitest-environment jsdom
// EX-01: an agreed trade whose funding window closed. An invitation that expired before anyone accepted is not this
// screen: nothing was agreed, so nothing "expired" from an agreement.
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TradeScreen } from '../src/trade/TradeScreen';
import { expectNoAxeViolations } from './axe';
import { SHELL_RULES, answerWith, id, renderWithApi, workspaceTrade, type CallFn } from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const show = (role: 'BUYER' | 'SELLER', over: Record<string, unknown> = {}) => {
  answerWith(api.call, { 'GET /trades/:id': workspaceTrade('EXPIRED', role, over) });
  return renderWithApi(api.call, <TradeScreen id={id(1)} />);
};

describe('EX-01 trade expired', () => {
  it('says the trade expired, shows what happened and the status rows', async () => {
    show('BUYER');
    expect(await screen.findByText('This trade has expired')).toBeTruthy();
    expect(screen.getByText('The funding window ended before funding was confirmed.')).toBeTruthy();
    const steps = screen.getByRole('list', { name: 'What happened' });
    expect(within(steps).getByText('Agreement accepted')).toBeTruthy();
    expect(within(steps).getByText('Funding window closed')).toBeTruthy();
    const status = screen.getByLabelText('Status');
    expect(within(status).getByText('Expired')).toBeTruthy();
    expect(within(status).getByText('Not confirmed')).toBeTruthy();
    expect(within(status).getByText('Start a new trade')).toBeTruthy();
    expect(screen.getByText(/expired terms are not silently reactivated/)).toBeTruthy();
  });

  it('lets the buyer start a new trade and check the payment', async () => {
    show('BUYER');
    expect((await screen.findByRole('link', { name: 'Start a new trade' })).getAttribute('href')).toBe(
      '/trade/new',
    );
    expect(screen.getByRole('link', { name: 'Check payment status' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/fund`,
    );
  });

  it('gives the seller the same record and no payment to check', async () => {
    show('SELLER');
    await screen.findByText('This trade has expired');
    expect(screen.getByRole('link', { name: 'Start a new trade' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Check payment status' })).toBeNull();
  });

  it('keeps the ordinary closed screen for an invitation that expired before acceptance', async () => {
    show('SELLER', { acceptedAt: null, initiatorRole: 'SELLER' });
    expect(await screen.findByText('Request expired')).toBeTruthy();
    expect(screen.queryByText('This trade has expired')).toBeNull();
  });

  it('has no serious accessibility violations', async () => {
    const { container } = show('BUYER');
    await screen.findByText('This trade has expired');
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});
