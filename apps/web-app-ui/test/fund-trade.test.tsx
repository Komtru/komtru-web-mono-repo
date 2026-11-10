// @vitest-environment jsdom
// F-024: Escrow Funding (V1, V2, V3) and its loading and failure states (AB3, AB4). The step on screen is the
// platform's display state; the money on screen is the trade's fee snapshot or the attempt, never a sum.
import { ProblemError, type PaystackInline } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FundTrade, type Checkout } from '../src/trade/funding/FundTrade';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  answerWith,
  callsTo,
  id,
  renderWithApi,
  workspaceTrade,
  type CallFn,
} from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

afterEach(cleanup);

const REFERENCE = `fund-${id(7)}`;
const attempt = (displayState: string, over: Record<string, unknown> = {}) => ({
  id: id(7),
  reference: REFERENCE,
  status: displayState === 'CONFIRMED' ? 'SUCCEEDED' : 'PENDING',
  displayState,
  currency: 'NGN',
  amountMinor: '45878000',
  itemAmountMinor: '45200000',
  buyerProtectionFeeMinor: '678000',
  initiatedAt: '2026-11-10T09:00:00.000Z',
  confirmedAt: displayState === 'CONFIRMED' ? '2026-11-10T09:14:00.000Z' : null,
  ...over,
});
const status = (displayState: string, over: Record<string, unknown> = {}) => ({
  tradeId: id(1),
  tradeCode: 'KMT-9042800-NG',
  displayState,
  attempt: displayState === 'NONE' ? null : attempt(displayState, over),
});
const initiated = (channels = ['card', 'ussd', 'bank_transfer']) => ({
  ...status('AWAITING_PAYMENT', { status: 'INITIATED' }),
  inline: {
    key: 'pk_test_x',
    email: 'ada@example.com',
    amount: 45878000,
    currency: 'NGN',
    reference: REFERENCE,
    channels,
  },
});

const problem = (code: string, httpStatus: number, detail?: string) =>
  new ProblemError(
    { type: 'about:blank', title: 'Reworded', status: httpStatus, code, ...(detail ? { detail } : {}) },
    {
      status: httpStatus,
      requestId: undefined,
      replayed: false,
      retryAfterMs: undefined,
      rateLimit: undefined,
    },
    false,
  );

/** A checkout that records what it was opened with and lets the test finish or close it. */
const fakeCheckout = () => {
  const opened: PaystackInline[] = [];
  let handlers: { onSuccess: () => void; onClose: () => void } | undefined;
  const checkout: Checkout = {
    open: (setup, h) => {
      opened.push(setup);
      handlers = h;
      return Promise.resolve();
    },
  };
  return {
    checkout,
    opened,
    succeed: () => handlers?.onSuccess(),
    close: () => handlers?.onClose(),
  };
};

let fake = fakeCheckout();
beforeEach(() => {
  api.call.mockReset();
  fake = fakeCheckout();
});

const serve = (
  payment: unknown,
  more: Record<string, unknown> = {},
  trade = workspaceTrade('PENDING_PAYMENT'),
) =>
  answerWith(api.call, {
    'GET /trades/:id': trade,
    'GET /trades/:code/payment/status': payment,
    ...more,
  });

const show = () => renderWithApi(api.call, <FundTrade id={id(1)} checkout={fake.checkout} />);

describe('V1: choose how to pay', () => {
  it('itemises the trade’s own fee snapshot and offers transfer, then card', async () => {
    serve(status('NONE'));
    const { container } = show();
    const fees = await screen.findByLabelText('What you pay');
    expect(screen.getByRole('heading', { level: 1, name: 'Fund & Protect' })).toBeTruthy();
    expect(within(fees).getByText('Item price').nextElementSibling?.textContent).toBe('₦452,000.00');
    expect(within(fees).getByText('Buyer Protection Fee').nextElementSibling?.textContent).toBe('₦6,780.00');
    expect(within(fees).getByText('Total to pay').nextElementSibling?.textContent).toBe('₦458,780.00');
    // C7/Q5: no logistics line; the rate is not on the wire, so it is not printed.
    expect(screen.queryByText(/Logistics/)).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
    // Q3: the wallet is off.
    expect(screen.queryByText(/Wallet/)).toBeNull();
    const methods = screen.getAllByRole('radio');
    expect(methods.map((m) => (m as HTMLInputElement).checked)).toEqual([true, false]);
    expect(screen.getByRole('button', { name: 'Continue with bank transfer' })).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/:code/payment/initiate')).toHaveLength(0);
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('pays by card or USSD in Paystack’s checkout, with only those channels and the platform’s own amount', async () => {
    serve(status('NONE'), {
      'POST /trades/:code/payment/initiate': initiated(),
      'POST /trades/:code/payment/confirm': status('VERIFYING'),
    });
    show();
    fireEvent.click(await screen.findByLabelText(/Debit card or USSD/));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with card or USSD' }));
    await waitFor(() => expect(fake.opened).toHaveLength(1));
    expect(fake.opened[0]).toMatchObject({
      key: 'pk_test_x',
      email: 'ada@example.com',
      amount: 45878000,
      currency: 'NGN',
      reference: REFERENCE,
      channels: ['card', 'ussd'],
    });
    expect(callsTo(api.call, 'POST', '/trades/:code/payment/initiate')[0]).toMatchObject({
      params: { code: id(1) },
      body: {},
    });
    fake.succeed();
    expect(await screen.findByText('Confirming your payment')).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/:code/payment/confirm')).toHaveLength(1);
  });

  it('says what the platform refused, and stays on the choice', async () => {
    serve(status('NONE'), {
      'POST /trades/:code/payment/initiate': problem(
        'CONTACT_VERIFICATION_REQUIRED',
        422,
        'Add and verify an email address to pay.',
      ),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with bank transfer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show account details' }));
    expect(await screen.findByText('Add and verify an email address to pay.')).toBeTruthy();
    expect(fake.opened).toHaveLength(0);
  });
});

describe('V2: bank transfer', () => {
  it('states the exact amount and opens Paystack’s one-time account for it, transfer only', async () => {
    serve(status('NONE'), {
      'POST /trades/:code/payment/initiate': initiated(),
      'POST /trades/:code/payment/confirm': status('VERIFYING'),
    });
    const { container } = show();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with bank transfer' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Bank Transfer' })).toBeTruthy();
    expect(screen.getByText('Transfer exactly').nextElementSibling?.textContent).toBe('₦458,780.00');
    await expectNoAxeViolations(container, SHELL_RULES);

    fireEvent.click(screen.getByRole('button', { name: 'Show account details' }));
    await waitFor(() => expect(fake.opened).toHaveLength(1));
    expect(fake.opened[0]?.channels).toEqual(['bank_transfer']);
    fake.succeed();
    expect(await screen.findByText('Confirming your payment')).toBeTruthy();
  });

  it('lets a buyer who closed the checkout after sending say so', async () => {
    serve(status('NONE'), {
      'POST /trades/:code/payment/initiate': initiated(),
      'POST /trades/:code/payment/confirm': status('VERIFYING'),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with bank transfer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show account details' }));
    await waitFor(() => expect(fake.opened).toHaveLength(1));
    fake.close();
    fireEvent.click(await screen.findByRole('button', { name: 'I have sent the funds' }));
    expect(await screen.findByText('Confirming your payment')).toBeTruthy();
  });

  it('opens straight on the transfer step from its own address, with a way back to the methods', async () => {
    serve(status('NONE'));
    renderWithApi(api.call, <FundTrade id={id(1)} checkout={fake.checkout} via="transfer" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Bank Transfer' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to payment methods' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/fund`,
    );
  });

  it('never adds a channel the platform did not offer', async () => {
    serve(status('NONE'), { 'POST /trades/:code/payment/initiate': initiated(['card']) });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with bank transfer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show account details' }));
    await waitFor(() => expect(fake.opened).toHaveLength(1));
    expect(fake.opened[0]?.channels).toEqual(['card']);
  });
});

describe('AB3: verifying', () => {
  it('names what is being waited on and how long, with no bare spinner', async () => {
    serve(status('VERIFYING'));
    const { container } = show();
    const loader = (await screen.findByText('Confirming your payment')).closest('[role="status"]');
    expect(loader).not.toBeNull();
    expect(within(loader as HTMLElement).getByText(/usually under 30 seconds/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /pay|transfer/i })).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

describe('AB4: not confirmed', () => {
  it('reassures, checks again on request, and can start a fresh payment', async () => {
    serve(status('NOT_CONFIRMED'), {
      'POST /trades/:code/payment/confirm': status('VERIFYING'),
    });
    const { container } = show();
    expect(
      await screen.findByRole('heading', { level: 2, name: "We couldn't confirm this payment" }),
    ).toBeTruthy();
    expect(screen.getByText(/your trade is still waiting, untouched/)).toBeTruthy();
    expect(screen.getByText(/KMT-9042800-NG/)).toBeTruthy();
    await expectNoAxeViolations(container, SHELL_RULES);
    fireEvent.click(screen.getByRole('button', { name: "I've sent it — check again" }));
    expect(await screen.findByText('Confirming your payment')).toBeTruthy();
  });

  it('starts again with a new reference, back at the choice of method', async () => {
    serve(status('NOT_CONFIRMED', { status: 'ABANDONED' }), {
      'POST /trades/:code/payment/initiate': initiated(),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Start the payment again' }));
    expect(await screen.findByLabelText('What you pay')).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/:code/payment/initiate')[0]).toMatchObject({
      body: { restart: true },
    });
    expect(fake.opened).toHaveLength(0);
  });
});

describe('V3: funds protected', () => {
  it('confirms the amount held, when, and the reference, and leads back to the trade', async () => {
    serve(status('CONFIRMED'));
    const { container } = show();
    expect(await screen.findByRole('heading', { level: 2, name: 'Funds protected' })).toBeTruthy();
    expect(screen.getByText(/₦458,780 is now held in escrow/)).toBeTruthy();
    expect(screen.getByText('Confirmed 10 Nov · 10:14')).toBeTruthy();
    expect(screen.getByText(`Reference: ${REFERENCE}`)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to trade timeline' }).getAttribute('href')).toBe(
      `/trade/${id(1)}`,
    );
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('is what a trade already funded shows', async () => {
    serve(status('CONFIRMED'), {}, workspaceTrade('FUNDED'));
    show();
    expect(await screen.findByRole('heading', { level: 2, name: 'Funds protected' })).toBeTruthy();
  });
});

describe('everything else', () => {
  it('holds a payment under review and says not to pay again', async () => {
    serve(status('UNDER_REVIEW'));
    show();
    expect(
      await screen.findByRole('heading', { level: 2, name: "We're checking this payment" }),
    ).toBeTruthy();
    expect(screen.getByText(/You don't need to pay again/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not offer the seller a way to pay, and never asks the platform', async () => {
    serve(status('NONE'), {}, workspaceTrade('PENDING_PAYMENT', 'SELLER'));
    show();
    expect(await screen.findByText('Only the buyer pays for a trade.')).toBeTruthy();
    expect(callsTo(api.call, 'GET', '/trades/:code/payment/status')).toHaveLength(0);
  });

  it('says a trade that is not awaiting payment cannot be paid for', async () => {
    serve(status('NONE'), {}, workspaceTrade('CANCELLED'));
    show();
    expect(await screen.findByText("This trade isn't waiting for payment.")).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });
});
