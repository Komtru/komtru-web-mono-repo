// @vitest-environment jsdom
// T-121 (SO4): "Where Should We Send Payouts?". The last step: the payout account is chosen or added, and the
// application is sent (or sent again after changes were asked for).
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SellPayout } from '../src/sell/Payout';
import { expectNoAxeViolations } from './axe';
import { problem } from './support/account';
import { SHELL_RULES, answerWith, callsTo, renderWithApi, type CallFn } from './support/trade';
import { PAYOUT_ACCOUNT_ID, allDocuments, application, payoutAccount } from './support/merchant';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push, replace: nav.replace }) }));

const READY = { 'GET /payouts/banks': { banks: [{ name: 'GTBank', code: '058' }] } };
const complete = application({
  status: 'DRAFT',
  form: { businessName: 'TechEdge NG', categories: ['electronics'], cacRcNumber: 'RC 1487XXX' },
  documents: allDocuments,
});

beforeEach(() => {
  api.call.mockReset();
  nav.push.mockReset();
  nav.replace.mockReset();
});
afterEach(cleanup);

describe('Where should we send payouts? (SO4)', () => {
  it('asks for a bank and a ten-digit number when no account is verified yet', async () => {
    answerWith(api.call, {
      ...READY,
      'GET /merchant/applications/me': complete,
      'GET /me/payout-accounts': { accounts: [] },
    });
    const { container } = renderWithApi(api.call, <SellPayout />);
    expect(await screen.findByLabelText('Bank')).toBeDefined();
    expect(screen.getByLabelText('Account number')).toBeDefined();
    expect(screen.getByText('4 / 5')).toBeDefined();
    expect(
      screen.getByText(/Must match your verified name — this is what keeps payouts from being redirected/),
    ).toBeDefined();
    const confirm = screen.getByRole<HTMLButtonElement>('button', { name: 'Confirm payout account' });
    expect(confirm.disabled).toBe(true);
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('adds the account and, once the bank has verified it, offers it as the choice', async () => {
    let accounts: unknown[] = [];
    answerWith(api.call, {
      ...READY,
      'GET /merchant/applications/me': complete,
      'GET /me/payout-accounts': () => ({ accounts }),
      'POST /me/payout-accounts': () => {
        accounts = [payoutAccount()];
        return payoutAccount({ status: 'PENDING_VERIFICATION', accountName: null, verifiedAt: null });
      },
    });
    renderWithApi(api.call, <SellPayout />);
    await screen.findByRole('option', { name: 'GTBank' });
    fireEvent.change(screen.getByLabelText('Bank'), { target: { value: '058' } });
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '0123456789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save payout account' }));
    await waitFor(() => expect(callsTo(api.call, 'POST', '/me/payout-accounts')).toHaveLength(1));
    expect(callsTo(api.call, 'POST', '/me/payout-accounts')[0]?.body).toEqual({
      bankCode: '058',
      accountNumber: '0123456789',
    });
    expect(await screen.findByRole('radio', { name: /GTBank/ })).toBeDefined();
    expect(screen.getByText(/TECHEDGE NIGERIA LTD/)).toBeDefined();
  });

  it('confirms a verified account: saves the choice, sends the application and goes to verification', async () => {
    answerWith(api.call, {
      ...READY,
      'GET /merchant/applications/me': complete,
      'GET /me/payout-accounts': { accounts: [payoutAccount()] },
      'PUT /merchant/applications/me': application({ ...complete, status: 'DRAFT' }),
      'POST /merchant/applications/:id/submit': application({
        status: 'SUBMITTED',
        submittedAt: '2026-11-19T09:00:00.000Z',
      }),
    });
    renderWithApi(api.call, <SellPayout />);
    const radio = await screen.findByRole<HTMLInputElement>('radio', { name: /GTBank/ });
    expect(radio.checked).toBe(true);
    expect(screen.queryByLabelText('Account number')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm payout account' }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/account/verification/merchant'));
    expect(callsTo(api.call, 'PUT', '/merchant/applications/me')[0]?.body).toEqual({
      payoutAccountId: PAYOUT_ACCOUNT_ID,
    });
    expect(callsTo(api.call, 'POST', '/merchant/applications/:id/submit')).toHaveLength(1);
    expect(callsTo(api.call, 'POST', '/merchant/applications/:id/resubmit')).toHaveLength(0);
  });

  it('resends the application, not a new one, when changes were asked for', async () => {
    answerWith(api.call, {
      ...READY,
      'GET /merchant/applications/me': application({
        ...complete,
        status: 'CHANGES_REQUESTED',
        changesRequested: [{ kind: 'FIELD', key: 'payoutAccountId' }],
      }),
      'GET /me/payout-accounts': { accounts: [payoutAccount()] },
      'PUT /merchant/applications/me': application({ status: 'CHANGES_REQUESTED' }),
      'POST /merchant/applications/:id/resubmit': application({ status: 'SUBMITTED' }),
    });
    renderWithApi(api.call, <SellPayout />);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm payout account' }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/account/verification/merchant'));
    expect(callsTo(api.call, 'POST', '/merchant/applications/:id/resubmit')).toHaveLength(1);
    expect(callsTo(api.call, 'POST', '/merchant/applications/:id/submit')).toHaveLength(0);
  });

  it('says what is still missing when the application cannot be sent, and stays here', async () => {
    answerWith(api.call, {
      ...READY,
      'GET /merchant/applications/me': complete,
      'GET /me/payout-accounts': { accounts: [payoutAccount()] },
      'PUT /merchant/applications/me': application(),
      'POST /merchant/applications/:id/submit': problem('VALIDATION_FAILED', 422),
    });
    renderWithApi(api.call, <SellPayout />);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm payout account' }));
    expect(
      await screen.findByText('Your application isn’t complete yet. Check the earlier steps and try again.'),
    ).toBeDefined();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('shows why an account was not verified and lets the person add another', async () => {
    answerWith(api.call, {
      ...READY,
      'GET /merchant/applications/me': complete,
      'GET /me/payout-accounts': {
        accounts: [
          payoutAccount({
            status: 'FAILED',
            accountName: null,
            failureReason: 'Your bank could not confirm this account.',
          }),
        ],
      },
    });
    renderWithApi(api.call, <SellPayout />);
    expect(await screen.findByText('Your bank could not confirm this account.')).toBeDefined();
    expect(screen.getByLabelText('Account number')).toBeDefined();
  });

  it('shows a loading state, and a load failure with a retry', async () => {
    answerWith(api.call, { ...READY, 'GET /merchant/applications/me': problem('INTERNAL', 500) });
    renderWithApi(api.call, <SellPayout />);
    expect(await screen.findByText('Couldn’t load your application')).toBeDefined();
  });
});
