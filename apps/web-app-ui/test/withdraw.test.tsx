// @vitest-environment jsdom
// F-037 (AB5): withdraw. The balance, the fee and every refusal are the platform's; one withdrawal is one key.
import { ProblemError } from '@komtru/api-client';
import { focusManager } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Withdraw } from '../src/payouts/Withdraw';
import { expectNoAxeViolations } from './axe';
import { SHELL_RULES, answerWith, callsTo, renderWithApi, type CallFn } from './support/trade';
import { ACCOUNT_ID, OTHER_ACCOUNT_ID, PAYOUT_ID, payout, payoutAccount, summary } from './support/payouts';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
  router.push.mockReset();
});
afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
});

const problem = (code: string, status = 409) =>
  new ProblemError(
    { type: 'about:blank', title: 'Reworded title', status, code },
    { status, requestId: undefined, replayed: false, retryAfterMs: undefined, rateLimit: undefined },
    false,
  );

const accounts = (...list: unknown[]) => ({ accounts: list });
const keyOf = (n: number) => api.call.mock.calls.filter(([e]) => e.method === 'post')[n]?.[2];

const amountField = () => screen.getByLabelText('Amount to withdraw, in naira');
const withdrawButton = () => screen.getByRole<HTMLButtonElement>('button', { name: /^Withdraw/ });

describe('Withdraw (AB5)', () => {
  it('offers the whole balance to the payout account, and lands on the payout once the platform has it', async () => {
    answerWith(api.call, {
      'GET /me/payouts/summary': summary(),
      'GET /me/payout-accounts': accounts(payoutAccount()),
      'POST /me/payouts': payout({ status: 'REQUESTED', amountMinor: '120000000' }),
    });
    const { container } = renderWithApi(api.call, <Withdraw />);
    expect(await screen.findByDisplayValue('1,200,000')).toBeTruthy();
    expect(screen.getByText(/Available: ₦1,200,000/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All', pressed: true })).toBeTruthy();
    expect(screen.getByText('GTBank •••• 5567')).toBeTruthy();
    expect(screen.getByText(/No payout fee is charged/)).toBeTruthy();
    await expectNoAxeViolations(container, SHELL_RULES);
    fireEvent.click(withdrawButton());
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/account/payouts/${PAYOUT_ID}`));
    expect(callsTo(api.call, 'POST', '/me/payouts')[0]?.body).toEqual({
      amountMinor: '120000000',
      payoutAccountId: ACCOUNT_ID,
    });
    expect(keyOf(0)?.idempotencyKey).toMatch(/^[\x21-\x7e]{8,}$/);
  });

  it('takes a typed or quick amount, and will not send more than the balance or nothing', async () => {
    answerWith(api.call, {
      'GET /me/payouts/summary': summary(),
      'GET /me/payout-accounts': accounts(payoutAccount()),
    });
    const { container } = renderWithApi(api.call, <Withdraw />);
    await screen.findByDisplayValue('1,200,000');
    fireEvent.click(screen.getByRole('button', { name: '₦200,000' }));
    expect(withdrawButton().textContent).toBe('Withdraw ₦200,000');
    fireEvent.change(amountField(), { target: { value: '1300000' } });
    expect(screen.getByRole('alert').textContent).toContain('That’s more than your available balance');
    await expectNoAxeViolations(container, SHELL_RULES);
    expect(withdrawButton().disabled).toBe(true);
    fireEvent.change(amountField(), { target: { value: '0' } });
    expect(withdrawButton().disabled).toBe(true);
    fireEvent.change(amountField(), { target: { value: 'abc' } });
    expect(withdrawButton().disabled).toBe(true);
    fireEvent.change(amountField(), { target: { value: '452000.50' } });
    expect(withdrawButton().textContent).toBe('Withdraw ₦452,000.50');
  });

  it('states the platform’s fee rather than working one out', async () => {
    answerWith(api.call, {
      'GET /me/payouts/summary': summary({ payoutFeeMinor: '5000' }),
      'GET /me/payout-accounts': accounts(payoutAccount()),
    });
    renderWithApi(api.call, <Withdraw />);
    expect(await screen.findByText(/A payout fee of ₦50 is taken from this amount/)).toBeTruthy();
  });

  it('lets the seller choose between verified accounts, payout account first, and leaves out unverified ones', async () => {
    answerWith(api.call, {
      'GET /me/payouts/summary': summary(),
      'GET /me/payout-accounts': accounts(
        payoutAccount({
          id: OTHER_ACCOUNT_ID,
          isDefault: false,
          bankName: 'Access Bank',
          accountNumberMasked: '******1234',
        }),
        payoutAccount({ id: ACCOUNT_ID }),
        payoutAccount({
          id: '0190b0a0-0000-7000-8000-000000000023',
          status: 'PENDING_VERIFICATION',
          isDefault: false,
        }),
      ),
      'POST /me/payouts': payout({ status: 'REQUESTED' }),
    });
    renderWithApi(api.call, <Withdraw />);
    const radios = await screen.findAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(within(radios[0]!.closest('label')!).getByText('GTBank •••• 5567')).toBeTruthy();
    expect((radios[0] as HTMLInputElement).checked).toBe(true);
    fireEvent.click(radios[1]!);
    fireEvent.click(withdrawButton());
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(callsTo(api.call, 'POST', '/me/payouts')[0]?.body).toEqual({
      amountMinor: '120000000',
      payoutAccountId: OTHER_ACCOUNT_ID,
    });
  });

  it('sends a retry after a lost answer with the same key, and a new withdrawal after a refusal with a new one', async () => {
    let attempt = 0;
    answerWith(api.call, {
      'GET /me/payouts/summary': summary(),
      'GET /me/payout-accounts': accounts(payoutAccount()),
      'POST /me/payouts': () => {
        attempt += 1;
        if (attempt === 1) throw new Error('offline');
        if (attempt === 2) throw problem('VALIDATION_FAILED', 422);
        return payout({ status: 'REQUESTED' });
      },
    });
    renderWithApi(api.call, <Withdraw />);
    await screen.findByDisplayValue('1,200,000');
    fireEvent.click(withdrawButton());
    expect((await screen.findByRole('alert')).textContent).toContain('Nothing was sent');
    fireEvent.click(withdrawButton());
    expect((await screen.findByRole('alert')).textContent).toContain('too small');
    expect(screen.getByRole('alert').textContent).not.toContain('Reworded title');
    fireEvent.click(withdrawButton());
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(keyOf(1)?.idempotencyKey).toBe(keyOf(0)?.idempotencyKey);
    expect(keyOf(2)?.idempotencyKey).not.toBe(keyOf(1)?.idempotencyKey);
  });

  it.each([
    ['a 503', 503, 'PAYMENT_PROVIDER_UNAVAILABLE'],
    ['a 409', 409, 'CONFLICT'],
  ])(
    'keeps the same key when a retry follows %s, which may have reached the platform',
    async (_name, status, code) => {
      let attempt = 0;
      answerWith(api.call, {
        'GET /me/payouts/summary': summary(),
        'GET /me/payout-accounts': accounts(payoutAccount()),
        'POST /me/payouts': () => {
          attempt += 1;
          if (attempt === 1) throw problem(code, status);
          return payout({ status: 'REQUESTED' });
        },
      });
      renderWithApi(api.call, <Withdraw />);
      await screen.findByDisplayValue('1,200,000');
      fireEvent.click(withdrawButton());
      await screen.findByRole('alert');
      fireEvent.click(withdrawButton());
      await waitFor(() => expect(router.push).toHaveBeenCalled());
      expect(keyOf(1)?.idempotencyKey).toBe(keyOf(0)?.idempotencyKey);
    },
  );

  it('keeps the form and its key when the balance fails to refresh after a withdrawal that may have gone through', async () => {
    let reads = 0;
    let posts = 0;
    answerWith(api.call, {
      'GET /me/payouts/summary': () => {
        reads += 1;
        if (reads > 1) throw new Error('offline');
        return summary();
      },
      'GET /me/payout-accounts': accounts(payoutAccount()),
      'POST /me/payouts': () => {
        posts += 1;
        if (posts === 1) throw problem('PAYMENT_PROVIDER_UNAVAILABLE', 503);
        return payout({ status: 'REQUESTED' });
      },
    });
    renderWithApi(api.call, <Withdraw />);
    await screen.findByDisplayValue('1,200,000');
    fireEvent.click(withdrawButton());
    await screen.findByRole('alert');
    await waitFor(() => expect(reads).toBeGreaterThan(1));
    expect(screen.queryByText('Couldn’t load your balance')).toBeNull();
    expect(screen.getByDisplayValue('1,200,000')).toBeTruthy();
    fireEvent.click(withdrawButton());
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(keyOf(1)?.idempotencyKey).toBe(keyOf(0)?.idempotencyKey);
  });

  it('falls back to the first verified account when the chosen one goes away', async () => {
    let list = [
      payoutAccount({ id: ACCOUNT_ID }),
      payoutAccount({
        id: OTHER_ACCOUNT_ID,
        isDefault: false,
        bankName: 'Access Bank',
        accountNumberMasked: '******1234',
      }),
    ];
    answerWith(api.call, {
      'GET /me/payouts/summary': summary(),
      'GET /me/payout-accounts': () => ({ accounts: list }),
      'POST /me/payouts': payout({ status: 'REQUESTED' }),
    });
    renderWithApi(api.call, <Withdraw />);
    const radios = await screen.findAllByRole('radio');
    fireEvent.click(radios[1]!);
    list = [list[0]!, payoutAccount({ id: '0190b0a0-0000-7000-8000-000000000024', isDefault: false })];
    // Coming back to the tab reads the accounts again, as the app does.
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(screen.getAllByRole<HTMLInputElement>('radio')[0]?.checked).toBe(true));
    fireEvent.click(withdrawButton());
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(callsTo(api.call, 'POST', '/me/payouts')[0]?.body).toEqual({
      amountMinor: '120000000',
      payoutAccountId: ACCOUNT_ID,
    });
  });

  it('words a pause and a missing account, and offers the way to add one', async () => {
    answerWith(api.call, {
      'GET /me/payouts/summary': summary({ held: true }),
      'GET /me/payout-accounts': accounts(payoutAccount({ status: 'FAILED', isDefault: false })),
    });
    renderWithApi(api.call, <Withdraw />);
    expect(await screen.findByText('Payouts on your account are paused')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add a bank account' }).getAttribute('href')).toBe(
      '/account/payouts/bank',
    );
    expect(withdrawButton().disabled).toBe(true);
  });
});
