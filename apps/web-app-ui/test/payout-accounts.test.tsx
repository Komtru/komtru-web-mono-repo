// @vitest-environment jsdom
// F-037 (AB6): the accounts a seller is paid into. Added with a bank and a number; verified by the bank, not typed.
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PayoutAccounts } from '../src/payouts/PayoutAccounts';
import { expectNoAxeViolations } from './axe';
import { SHELL_RULES, answerWith, callsTo, renderWithApi, type CallFn } from './support/trade';
import { ACCOUNT_ID, OTHER_ACCOUNT_ID, payoutAccount } from './support/payouts';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const problem = (code: string, status = 409) =>
  new ProblemError(
    { type: 'about:blank', title: 'Reworded title', status, code },
    { status, requestId: undefined, replayed: false, retryAfterMs: undefined, rateLimit: undefined },
    false,
  );
const BANKS = {
  banks: [
    { name: 'Access Bank', code: '044' },
    { name: 'GTBank', code: '058' },
  ],
};
const other = (over: Record<string, unknown> = {}) =>
  payoutAccount({
    id: OTHER_ACCOUNT_ID,
    bankName: 'Access Bank',
    bankCode: '044',
    accountNumberMasked: '******1234',
    isDefault: false,
    ...over,
  });

describe('Payout Account (AB6)', () => {
  it('lists each account as the bank left it: the payout account, being checked, and failed with its reason', async () => {
    answerWith(api.call, {
      'GET /payouts/banks': BANKS,
      'GET /me/payout-accounts': {
        accounts: [
          payoutAccount(),
          other({ status: 'PENDING_VERIFICATION', accountName: null, verifiedAt: null }),
          other({
            id: '0190b0a0-0000-7000-8000-000000000023',
            status: 'FAILED',
            accountName: null,
            failureReason: 'The bank could not find this account number.',
          }),
        ],
      },
    });
    const { container } = renderWithApi(api.call, <PayoutAccounts />);
    const list = await screen.findByRole('list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]?.textContent).toContain('GTBank •••• 5567');
    expect(rows[0]?.textContent).toContain('ADA OBI');
    expect(rows[0]?.textContent).toContain('Payout account');
    expect(rows[1]?.textContent).toContain('Checking this account with your bank');
    expect(rows[2]?.textContent).toContain('The bank could not find this account number.');
    expect(screen.queryByRole('button', { name: /Make this my payout account/ })).toBeNull();
    await screen.findByRole('option', { name: 'GTBank' });
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('adds an account with the bank and the ten-digit number only, and clears the form', async () => {
    const stored: unknown[] = [];
    answerWith(api.call, {
      'GET /payouts/banks': BANKS,
      'GET /me/payout-accounts': () => ({ accounts: stored }),
      'POST /me/payout-accounts': () => {
        const row = payoutAccount({ status: 'PENDING_VERIFICATION', isDefault: false, accountName: null });
        stored.push(row);
        return row;
      },
    });
    renderWithApi(api.call, <PayoutAccounts />);
    await screen.findByRole('option', { name: 'GTBank' });
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save payout account' });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Bank'), { target: { value: '058' } });
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '01234 5556' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '0123455567' } });
    fireEvent.click(save);
    expect(await screen.findByText('Checking this account with your bank…')).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/me/payout-accounts')[0]?.body).toEqual({
      bankCode: '058',
      accountNumber: '0123455567',
    });
    expect(screen.getByLabelText<HTMLInputElement>('Account number').value).toBe('');
  });

  it('words an account the platform will not take', async () => {
    answerWith(api.call, {
      'GET /payouts/banks': BANKS,
      'GET /me/payout-accounts': { accounts: [] },
      'POST /me/payout-accounts': problem('VALIDATION_FAILED', 422),
    });
    renderWithApi(api.call, <PayoutAccounts />);
    await screen.findByRole('option', { name: 'GTBank' });
    fireEvent.change(screen.getByLabelText('Bank'), { target: { value: '058' } });
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '0123455567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save payout account' }));
    expect((await screen.findByRole('alert')).textContent).toContain('ten-digit');
  });

  it('makes another verified account the payout account', async () => {
    let defaultId = ACCOUNT_ID;
    answerWith(api.call, {
      'GET /payouts/banks': BANKS,
      'GET /me/payout-accounts': () => ({
        accounts: [
          payoutAccount({ isDefault: defaultId === ACCOUNT_ID }),
          other({ isDefault: defaultId === OTHER_ACCOUNT_ID }),
        ],
      }),
      'POST /me/payout-accounts/:id/default': ({ params }: { params?: Record<string, string> }) => {
        defaultId = params?.id ?? '';
        return other({ isDefault: true });
      },
    });
    renderWithApi(api.call, <PayoutAccounts />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Make this my payout account: Access Bank •••• 1234' }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Make this my payout account: GTBank •••• 5567' }),
      ).toBeTruthy(),
    );
    expect(callsTo(api.call, 'POST', '/me/payout-accounts/:id/default')[0]?.params).toEqual({
      id: OTHER_ACCOUNT_ID,
    });
  });

  it('asks before removing, and says why the platform refused', async () => {
    answerWith(api.call, {
      'GET /payouts/banks': BANKS,
      'GET /me/payout-accounts': { accounts: [payoutAccount()] },
      'DELETE /me/payout-accounts/:id': problem('PAYOUT_ACCOUNT_REQUIRED'),
    });
    renderWithApi(api.call, <PayoutAccounts />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove GTBank •••• 5567' }));
    const sheet = screen.getByRole('dialog', { name: 'Remove GTBank •••• 5567?' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove account' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Your automatic payouts go to this account.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(callsTo(api.call, 'DELETE', '/me/payout-accounts/:id')[0]?.params).toEqual({ id: ACCOUNT_ID });
  });
});
