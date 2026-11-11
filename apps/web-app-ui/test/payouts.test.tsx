// @vitest-environment jsdom
// F-037 (Seller-6): the balance, how the seller is paid, and the history. Every figure is the platform's summary.
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Payouts } from '../src/payouts/Payouts';
import { expectNoAxeViolations } from './axe';
import { SHELL_RULES, answerWith, callsTo, id, renderWithApi, type CallFn } from './support/trade';
import { PAYOUT_ID, destination, payout, summary } from './support/payouts';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const list = (items: unknown[], nextCursor: string | null = null) => ({ items, nextCursor });
const problem = (code: string, status = 409) =>
  new ProblemError(
    { type: 'about:blank', title: 'Reworded title', status, code },
    { status, requestId: undefined, replayed: false, retryAfterMs: undefined, rateLimit: undefined },
    false,
  );

describe('Payouts (Seller-6)', () => {
  it('shows the available balance, the payout account and the recent payouts, each opening its receipt', async () => {
    answerWith(api.call, {
      'GET /me/payouts/summary': summary(),
      'GET /me/payouts': list([
        payout(),
        payout({
          id: id(12),
          status: 'FAILED',
          amountMinor: '8950000',
          requestedAt: '2026-08-02T10:20:00.000Z',
        }),
      ]),
    });
    const { container } = renderWithApi(api.call, <Payouts />);
    expect(await screen.findByText('₦1,200,000')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Payouts' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Withdraw' }).getAttribute('href')).toBe(
      '/account/payouts/withdraw',
    );
    expect(screen.getByRole('link', { name: /GTBank •••• 5567.*Change/ }).getAttribute('href')).toBe(
      '/account/payouts/bank',
    );
    const rows = within(await screen.findByRole('list', { name: 'Recent payouts' })).getAllByRole('link');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute('href')).toBe(`/account/payouts/${PAYOUT_ID}`);
    expect(rows[0]?.textContent).toContain('₦452,000');
    expect(rows[0]?.textContent).not.toContain('Completed');
    expect(rows[1]?.textContent).toContain('Didn’t go through');
    expect(rows[1]?.textContent).toContain('₦89,500');
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says what is on its way, and stops a withdrawal while payouts are paused or there is nothing to take', async () => {
    answerWith(api.call, {
      'GET /me/payouts/summary': summary({ held: true, inFlightMinor: '5000000' }),
      'GET /me/payouts': list([]),
    });
    renderWithApi(api.call, <Payouts />);
    expect(await screen.findByText('Payouts on your account are paused')).toBeTruthy();
    expect(screen.getByText('₦50,000 is on its way to your bank.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Withdraw' })).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Withdraw' }).disabled).toBe(true);
    expect(await screen.findByText('No payouts yet')).toBeTruthy();
  });

  it('asks for a bank account when there is none', async () => {
    answerWith(api.call, {
      'GET /me/payouts/summary': summary({ defaultAccount: null, availableMinor: '0' }),
      'GET /me/payouts': list([]),
    });
    renderWithApi(api.call, <Payouts />);
    const add = await screen.findByRole('link', { name: 'Add a bank account' });
    expect(add.getAttribute('href')).toBe('/account/payouts/bank');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Withdraw' }).disabled).toBe(true);
  });

  it('reads older payouts on request', async () => {
    answerWith(api.call, {
      'GET /me/payouts/summary': summary(),
      'GET /me/payouts': ({ query }: { query?: Record<string, unknown> }) =>
        query?.cursor === undefined ? list([payout()], 'c2') : list([payout({ id: id(13) })]),
    });
    renderWithApi(api.call, <Payouts />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show older payouts' }));
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: 'Recent payouts' })).getAllByRole('link')).toHaveLength(
        2,
      ),
    );
    expect(screen.queryByRole('button', { name: 'Show older payouts' })).toBeNull();
  });

  it('changes how the seller is paid from the Schedule sheet', async () => {
    let mode = 'MANUAL';
    answerWith(api.call, {
      'GET /me/payouts/summary': () => summary({ mode }),
      'GET /me/payouts': list([]),
      'PUT /me/payout-preferences': ({ body }: { body?: unknown }) => {
        mode = (body as { mode: string }).mode;
        return { mode, defaultAccount: destination() };
      },
    });
    renderWithApi(api.call, <Payouts />);
    fireEvent.click(await screen.findByRole('button', { name: 'Schedule' }));
    const sheet = screen.getByRole('dialog', { name: 'How do you want to be paid?' });
    expect(within(sheet).getByRole<HTMLInputElement>('radio', { name: /When I withdraw/ }).checked).toBe(
      true,
    );
    expect(within(sheet).getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true);
    fireEvent.click(within(sheet).getByRole('radio', { name: /Weekly/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(callsTo(api.call, 'PUT', '/me/payout-preferences')[0]?.body).toEqual({ mode: 'AUTO_WEEKLY' });
    expect(await screen.findByText(/Paid weekly/)).toBeTruthy();
  });

  it('says an automatic mode needs a verified account, with the way to add one', async () => {
    answerWith(api.call, {
      'GET /me/payouts/summary': summary({ defaultAccount: null }),
      'GET /me/payouts': list([]),
      'PUT /me/payout-preferences': problem('PAYOUT_ACCOUNT_REQUIRED'),
    });
    renderWithApi(api.call, <Payouts />);
    fireEvent.click(await screen.findByRole('button', { name: 'Schedule' }));
    const sheet = screen.getByRole('dialog');
    fireEvent.click(within(sheet).getByRole('radio', { name: /Daily/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    const alert = await within(sheet).findByRole('alert');
    expect(alert.textContent).toContain('Add a verified bank account before choosing automatic payouts.');
    expect(within(alert).getByRole('link', { name: 'Add a bank account' }).getAttribute('href')).toBe(
      '/account/payouts/bank',
    );
    expect(alert.textContent).not.toContain('Reworded title');
  });

  it('says so and lets the seller try again when the balance cannot be read', async () => {
    let attempt = 0;
    answerWith(api.call, {
      'GET /me/payouts/summary': () => {
        attempt += 1;
        if (attempt === 1) throw new Error('offline');
        return summary();
      },
      'GET /me/payouts': list([]),
    });
    renderWithApi(api.call, <Payouts />);
    expect(await screen.findByText('Couldn’t load your payouts')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(await screen.findByText('₦1,200,000')).toBeTruthy();
  });
});
