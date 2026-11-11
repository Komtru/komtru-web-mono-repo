// @vitest-environment jsdom
// F-037 (PR1, WF1): one payout as the platform settled it. Every figure is the payout's own frozen figure.
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PayoutReceipt } from '../src/payouts/PayoutReceipt';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  answerWith,
  counterparty,
  id,
  renderWithApi,
  tradeView,
  type CallFn,
} from './support/trade';
import { PAYOUT_ID, payout } from './support/payouts';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const problem = (code: string, status = 404) =>
  new ProblemError(
    { type: 'about:blank', title: 'Reworded title', status, code },
    { status, requestId: undefined, replayed: false, retryAfterMs: undefined, rateLimit: undefined },
    false,
  );

const term = (label: string) => {
  const list = screen.getByLabelText('Payout details');
  const dt = within(list).getByText(label);
  return dt.parentElement?.querySelector('dd')?.textContent;
};

describe('Payout receipt (PR1)', () => {
  it('shows what reached the bank, from where, the reference and when it was sent and arrived', async () => {
    answerWith(api.call, { 'GET /me/payouts/:id': payout() });
    const { container } = renderWithApi(api.call, <PayoutReceipt id={PAYOUT_ID} />);
    expect(await screen.findByText('₦452,000.00', { selector: 'p' })).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
    expect(term('To')).toBe('GTBank •••• 5567');
    expect(term('Name')).toBe('ADA OBI');
    expect(term('Reference')).toBe(`payout-${PAYOUT_ID}`);
    expect(term('Initiated')).toBe('6 Aug · 14:41');
    expect(term('Arrived')).toBe('6 Aug · 15:02');
    expect(screen.queryByRole('region', { name: 'From trade' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to payouts' }).getAttribute('href')).toBe(
      '/account/payouts',
    );
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('shows the frozen fee and what left the balance as the platform recorded them, never worked out', async () => {
    answerWith(api.call, {
      'GET /me/payouts/:id': payout({
        amountMinor: '45200000',
        feeMinor: '5000',
        transferAmountMinor: '45195000',
      }),
    });
    renderWithApi(api.call, <PayoutReceipt id={PAYOUT_ID} />);
    expect(await screen.findByText('₦451,950.00')).toBeTruthy();
    expect(term('From your balance')).toBe('₦452,000.00');
    expect(term('Payout fee')).toBe('₦50.00');
  });

  it('names the trade an automatic payout came from, and links to it', async () => {
    const tradeId = id(1);
    answerWith(api.call, {
      'GET /me/payouts/:id': payout({ trigger: 'AUTO_IMMEDIATE', sourceTradeId: tradeId }),
      'GET /trades/:id': tradeView({
        tradeCode: 'KMT-8821300-NG',
        counterparty: counterparty({ displayName: 'Amaka B.' }),
      }),
    });
    renderWithApi(api.call, <PayoutReceipt id={PAYOUT_ID} />);
    const region = await screen.findByRole('region', { name: 'From trade' });
    expect(await within(region).findByText('KMT-8821300-NG · Amaka B.')).toBeTruthy();
    expect(within(region).getByRole('link').getAttribute('href')).toBe(`/trade/${tradeId}`);
  });

  it('says a payout on its way updates itself, with no arrival time yet', async () => {
    answerWith(api.call, { 'GET /me/payouts/:id': payout({ status: 'PROCESSING', completedAt: null }) });
    renderWithApi(api.call, <PayoutReceipt id={PAYOUT_ID} />);
    expect(await screen.findByText('On its way')).toBeTruthy();
    expect(screen.getByText(/updates when your bank confirms/)).toBeTruthy();
    expect(screen.queryByText('Arrived')).toBeNull();
  });

  it('says a payout in review is being checked, never that it failed or arrived', async () => {
    answerWith(api.call, { 'GET /me/payouts/:id': payout({ status: 'NEEDS_REVIEW', completedAt: null }) });
    renderWithApi(api.call, <PayoutReceipt id={PAYOUT_ID} />);
    expect(await screen.findByText('Our team is checking this payout')).toBeTruthy();
    expect(screen.queryByText('Completed')).toBeNull();
    expect(screen.queryByText(/didn’t go through/)).toBeNull();
  });

  it('says a payout that is not the seller’s cannot be found, with no retry', async () => {
    answerWith(api.call, { 'GET /me/payouts/:id': problem('NOT_FOUND') });
    renderWithApi(api.call, <PayoutReceipt id={PAYOUT_ID} />);
    expect(await screen.findByText('We can’t find that payout')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /try again|retry/i })).toBeNull();
  });
});

describe('Withdrawal failed (WF1)', () => {
  it('says the money is back in the balance, why the bank refused, and the two ways forward', async () => {
    answerWith(api.call, {
      'GET /me/payouts/:id': payout({
        status: 'FAILED',
        amountMinor: '120000000',
        completedAt: null,
        failedAt: '2026-08-06T14:00:00.000Z',
        failureReason: 'Bank declined — account may be inactive or frozen',
      }),
    });
    const { container } = renderWithApi(api.call, <PayoutReceipt id={PAYOUT_ID} />);
    expect(await screen.findByRole('heading', { name: 'This withdrawal didn’t go through' })).toBeTruthy();
    expect(screen.getByText(/₦1,200,000 is back in your available balance/)).toBeTruthy();
    expect(screen.getByText('Bank declined — account may be inactive or frozen')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe(
      '/account/payouts/withdraw',
    );
    expect(screen.getByRole('link', { name: 'Use a different account' }).getAttribute('href')).toBe(
      '/account/payouts/bank',
    );
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('calls a payout reversed after it was sent one that came back', async () => {
    answerWith(api.call, { 'GET /me/payouts/:id': payout({ status: 'REVERSED', failureReason: null }) });
    renderWithApi(api.call, <PayoutReceipt id={PAYOUT_ID} />);
    expect(await screen.findByRole('heading', { name: 'This payout came back' })).toBeTruthy();
    expect(screen.getByText('Your bank didn’t accept this payout.')).toBeTruthy();
  });

  it('lets the seller try again when the payout cannot be read', async () => {
    let attempt = 0;
    answerWith(api.call, {
      'GET /me/payouts/:id': () => {
        attempt += 1;
        if (attempt === 1) throw new Error('offline');
        return payout();
      },
    });
    renderWithApi(api.call, <PayoutReceipt id={PAYOUT_ID} />);
    fireEvent.click(await screen.findByRole('button', { name: /try again|retry/i }));
    expect(await screen.findByText('Completed')).toBeTruthy();
  });
});
