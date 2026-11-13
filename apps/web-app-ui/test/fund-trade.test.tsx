// @vitest-environment jsdom
// F-024: Escrow Funding (V1, V2, V3) and its loading and failure states (AB3, AB4). The step on screen is the
// platform's display state; the money on screen is the trade's fee snapshot or the attempt, never a sum.
import { ProblemError, type PaystackInline } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAYMENT_POLL_MS } from '@komtru/api-client/react';
import { FundTrade, TRADE_FOLLOW_MS, type Checkout } from '../src/trade/funding/FundTrade';
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
  let handlers: Parameters<Checkout['open']>[1] | undefined;
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
    fail: () => handlers?.onError(),
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
  trade: unknown = workspaceTrade('PENDING_PAYMENT'),
) =>
  answerWith(api.call, {
    'GET /trades/:id': trade,
    'GET /trades/:code/payment/status': payment,
    ...more,
  });

const show = () => renderWithApi(api.call, <FundTrade id={id(1)} checkout={fake.checkout} />);

describe('a buyer request the seller has not completed', () => {
  const terms = (itemSpec: Record<string, unknown>) => ({
    ...workspaceTrade('PENDING_PAYMENT').terms,
    itemSpec,
  });

  it('cannot reach funding: no payment is read or started', async () => {
    serve(
      status('NONE'),
      {},
      workspaceTrade('PENDING_PAYMENT', 'BUYER', {
        terms: terms({ requestedItem: 'iPhone', brand: 'Seller to confirm', deliveryMode: 'COURIER' }),
      }),
    );
    show();
    expect(await screen.findByText(/hasn't confirmed the item details yet/)).toBeTruthy();
    expect(screen.queryByLabelText('What you pay')).toBeNull();
    expect(callsTo(api.call, 'GET', '/trades/:code/payment/status')).toHaveLength(0);
    expect(callsTo(api.call, 'POST', '/trades/:code/payment/initiate')).toHaveLength(0);
    for (const link of screen.getAllByRole('link', { name: 'Back to the trade' })) {
      expect(link.getAttribute('href')).toBe(`/trade/${id(1)}`);
    }
  });

  it('says the seller delivery charge is outside Komtru protection and not in the total', async () => {
    serve(
      status('NONE'),
      {},
      workspaceTrade('PENDING_PAYMENT', 'BUYER', {
        terms: terms({ brand: 'Apple', deliveryMode: 'COURIER', deliveryChargeMinor: '250000' }),
      }),
    );
    show();
    expect(
      await screen.findByText(/delivery charge of ₦2,500.00 is paid to the seller outside Komtru protection/),
    ).toBeTruthy();
  });
});

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
    expect(screen.getByRole('button', { name: 'Continue to payment' })).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm & pay' }));
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
    expect(await screen.findByText('Verifying your payment')).toBeTruthy();
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
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to payment' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm & pay' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to payment' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm & pay' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Bank Transfer' })).toBeTruthy();
    expect(screen.getByText('Transfer exactly').nextElementSibling?.textContent).toBe('₦458,780.00');
    await expectNoAxeViolations(container, SHELL_RULES);

    fireEvent.click(screen.getByRole('button', { name: 'Show account details' }));
    await waitFor(() => expect(fake.opened).toHaveLength(1));
    expect(fake.opened[0]?.channels).toEqual(['bank_transfer']);
    fake.succeed();
    expect(await screen.findByText('Verifying your payment')).toBeTruthy();
  });

  it('lets a buyer who closed the checkout after sending say so', async () => {
    serve(status('NONE'), {
      'POST /trades/:code/payment/initiate': initiated(),
      'POST /trades/:code/payment/confirm': status('VERIFYING'),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to payment' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm & pay' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show account details' }));
    await waitFor(() => expect(fake.opened).toHaveLength(1));
    fake.close();
    fireEvent.click(await screen.findByRole('button', { name: 'I have sent the funds' }));
    expect(await screen.findByText('Verifying your payment')).toBeTruthy();
  });

  it('opens straight on the transfer step from its own address, and steps back to the methods', async () => {
    serve(status('NONE'));
    renderWithApi(api.call, <FundTrade id={id(1)} checkout={fake.checkout} via="transfer" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Bank Transfer' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to payment methods' }));
    expect(await screen.findByLabelText('What you pay')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Fund & Protect' })).toBeTruthy();
  });

  it('steps back from the transfer step to the methods it came from', async () => {
    serve(status('NONE'));
    show();
    fireEvent.click(await screen.findByLabelText(/Debit card or USSD/));
    fireEvent.click(screen.getByLabelText(/Bank transfer/));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm & pay' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Bank Transfer' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to payment methods' }));
    expect(await screen.findByLabelText('What you pay')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(/Bank transfer/).checked).toBe(true);
  });

  it('says so when Paystack cannot take the payment, and lets the buyer try again', async () => {
    serve(status('NONE'), { 'POST /trades/:code/payment/initiate': initiated() });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to payment' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm & pay' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show account details' }));
    await waitFor(() => expect(fake.opened).toHaveLength(1));
    fake.fail();
    expect(await screen.findByText(/Paystack couldn't take this payment/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'I have sent the funds' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show account details' })).toBeTruthy();
  });

  it('says the trade is already being paid for when the platform refuses a second payment', async () => {
    serve(status('NONE'), { 'POST /trades/:code/payment/initiate': problem('CONFLICT', 409) });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to payment' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm & pay' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show account details' }));
    expect(await screen.findByText(/already been paid for, or a payment is in progress/)).toBeTruthy();
    expect(fake.opened).toHaveLength(0);
  });

  it('never adds a channel the platform did not offer', async () => {
    serve(status('NONE'), { 'POST /trades/:code/payment/initiate': initiated(['card']) });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to payment' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm & pay' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show account details' }));
    await waitFor(() => expect(fake.opened).toHaveLength(1));
    expect(fake.opened[0]?.channels).toEqual(['card']);
  });
});

describe('AB3: verifying', () => {
  it('names what is being waited on and how long, with no bare spinner', async () => {
    serve(status('VERIFYING'));
    const { container } = show();
    const loader = (await screen.findByText('Verifying your payment')).closest('[role="status"]');
    expect(loader).not.toBeNull();
    expect(within(loader as HTMLElement).getByText(/usually under 30 seconds/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /pay|transfer/i })).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

describe('AB3 to V3: polling', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks again while verifying, moves on to V3 once confirmed, then stops asking', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let answer = 'VERIFYING';
    serve(() => status(answer));
    show();
    expect(await screen.findByText('Verifying your payment')).toBeTruthy();
    answer = 'CONFIRMED';
    await vi.advanceTimersByTimeAsync(PAYMENT_POLL_MS + 50);
    expect(await screen.findByRole('heading', { level: 2, name: 'Funds protected' })).toBeTruthy();
    const asked = callsTo(api.call, 'GET', '/trades/:code/payment/status').length;
    await vi.advanceTimersByTimeAsync(PAYMENT_POLL_MS * 3);
    expect(callsTo(api.call, 'GET', '/trades/:code/payment/status')).toHaveLength(asked);
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
    expect(await screen.findByText('Verifying your payment')).toBeTruthy();
  });

  it('starts again with a new reference, back at the choice of method', async () => {
    serve(status('NOT_CONFIRMED', { status: 'ABANDONED' }), {
      'POST /trades/:code/payment/initiate': initiated(),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Try payment again' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start again' }));
    expect(await screen.findByLabelText('What you pay')).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/:code/payment/initiate')[0]).toMatchObject({
      body: { restart: true },
    });
    expect(fake.opened).toHaveLength(0);
  });
});

describe('AB4: when the platform refuses', () => {
  it('shows why checking again failed', async () => {
    serve(status('NOT_CONFIRMED'), {
      'POST /trades/:code/payment/confirm': problem('RATE_LIMITED', 429),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: "I've sent it — check again" }));
    expect(await screen.findByText('Too many tries. Wait a minute and try again.')).toBeTruthy();
  });

  it.each([
    [
      'a refusal within the grace period',
      problem('CONFLICT', 409, 'A payment on this trade may still land.'),
    ],
    ['an error', problem('INTERNAL', 500)],
  ])('stays on AB4 and says why after %s to start again', async (_, refusal) => {
    serve(status('NOT_CONFIRMED'), { 'POST /trades/:code/payment/initiate': refusal });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Try payment again' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start again' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: "We couldn't confirm this payment" })).toBeTruthy();
  });
});

describe('V3: funds protected', () => {
  it('confirms the amount held, when, and the reference, and leads back to the trade', async () => {
    serve(status('CONFIRMED'));
    const { container } = show();
    expect(await screen.findByRole('heading', { level: 2, name: 'Funds protected' })).toBeTruthy();
    expect(screen.getByText(/₦458,780 is now held in escrow/)).toBeTruthy();
    expect(screen.getByText('Confirmed 10 Nov · 10:14')).toBeTruthy();
    expect(within(screen.getByLabelText('Protected payment')).getByText(REFERENCE)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View delivery' }).getAttribute('href')).toBe(`/trade/${id(1)}`);
    expect(screen.getByRole('link', { name: 'Back to trade timeline' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/activity`,
    );
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('keeps reading the trade until the platform has moved it to funded, and then says the seller is told', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let trade = workspaceTrade('PENDING_PAYMENT');
    serve(status('CONFIRMED'), {}, () => trade);
    show();
    expect(await screen.findByText(/will be told it's safe to dispatch/)).toBeTruthy();
    trade = workspaceTrade('FUNDED');
    await vi.advanceTimersByTimeAsync(TRADE_FOLLOW_MS + 50);
    expect(await screen.findByText(/is told it's safe to dispatch/)).toBeTruthy();
    const reads = callsTo(api.call, 'GET', '/trades/:id').length;
    await vi.advanceTimersByTimeAsync(TRADE_FOLLOW_MS * 3);
    expect(callsTo(api.call, 'GET', '/trades/:id')).toHaveLength(reads);
    vi.useRealTimers();
  });

  it('notes a second payment under review on a trade that is already funded', async () => {
    serve(status('UNDER_REVIEW'), {}, workspaceTrade('FUNDED'));
    show();
    expect(await screen.findByRole('heading', { level: 2, name: 'Funds protected' })).toBeTruthy();
    expect(screen.getByText(/Another payment for this trade is being checked/)).toBeTruthy();
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

  it.each(['CONFIRMED', 'UNDER_REVIEW'])(
    'holds a trade that ended with a %s payment for review rather than saying it was never paid',
    async (displayState) => {
      serve(status(displayState), {}, workspaceTrade('CANCELLED'));
      show();
      expect(
        await screen.findByRole('heading', { level: 2, name: "We're checking this payment" }),
      ).toBeTruthy();
      expect(screen.queryByText("This trade isn't waiting for payment.")).toBeNull();
    },
  );

  it('says when the payment cannot be read, and reads it again on request', async () => {
    let fail = true;
    serve(() => (fail ? new Error('offline') : status('NONE')));
    show();
    expect(await screen.findByText("Couldn't read the payment")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByLabelText('What you pay')).toBeTruthy();
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

describe('F-023: the payment sequence in the v2 reference (TW-03, CWT-S03 to CWT-S07)', () => {
  it('TW-03 and CWT-S03: names the trade, says the funds are protected, and offers no wallet', async () => {
    serve(status('NONE'));
    show();
    const fees = await screen.findByLabelText('What you pay');
    expect(within(fees).getByText('Trade reference').nextElementSibling?.textContent).toBe('KMT-9042800-NG');
    expect(screen.getByText(/Your funds are protected for this trade/)).toBeTruthy();
    expect(screen.queryByText(/wallet/i)).toBeNull();
    expect(screen.getByRole('link', { name: 'Cancel' }).getAttribute('href')).toBe(`/trade/${id(1)}`);
    expect(screen.queryByText('A payment was started and not completed')).toBeNull();
  });

  it('TW-03: says payment is awaiting the provider when an attempt has been started and not confirmed', async () => {
    serve(status('AWAITING_PAYMENT', { status: 'INITIATED' }));
    show();
    expect(await screen.findByText('A payment was started and not completed')).toBeTruthy();
    expect(screen.getByText(/Nothing has been charged or confirmed yet/)).toBeTruthy();
    expect(screen.queryByText(/Keep this screen open/)).toBeNull();
  });

  it('CWT-S04: reviews the item, the amounts and the method before anything is charged', async () => {
    serve(status('NONE'), { 'POST /trades/:code/payment/initiate': initiated() });
    const { container } = show();
    fireEvent.click(await screen.findByLabelText(/Debit card or USSD/));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Review Payment' })).toBeTruthy();
    const fees = screen.getByLabelText('What you pay');
    expect(within(fees).getByText('Total').nextElementSibling?.textContent).toBe('₦458,780.00');
    expect(within(screen.getByLabelText('Payment method')).getByText('Debit card or USSD')).toBeTruthy();
    expect(screen.getByText(/only after the payment provider confirms/)).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/:code/payment/initiate')).toHaveLength(0);
    await expectNoAxeViolations(container, SHELL_RULES);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByLabelText<HTMLInputElement>(/Debit card or USSD/)).toMatchObject({
      checked: true,
    });
  });

  it('CWT-S05: lists the reference, amount and states, says waiting is not protected, and checks again on request', async () => {
    serve(status('VERIFYING'));
    const { container } = show();
    const rows = await screen.findByLabelText('Payment');
    expect(within(rows).getByText(REFERENCE)).toBeTruthy();
    expect(within(rows).getByText('₦458,780.00')).toBeTruthy();
    expect(within(rows).getByText('Processing')).toBeTruthy();
    expect(within(rows).getByText('Awaiting confirmation')).toBeTruthy();
    expect(screen.getByText(/not the same as protected funds/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Return to trade' }).getAttribute('href')).toBe(
      `/trade/${id(1)}`,
    );
    await expectNoAxeViolations(container, SHELL_RULES);

    const before = callsTo(api.call, 'GET', '/trades/:code/payment/status').length;
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
    await waitFor(() =>
      expect(callsTo(api.call, 'GET', '/trades/:code/payment/status').length).toBeGreaterThan(before),
    );
    expect(callsTo(api.call, 'POST', '/trades/:code/payment/confirm')).toHaveLength(0);
  });

  it('CWT-S06: states the protected amount, reference and that the payout is held, and that dispatch is eligible', async () => {
    serve(status('CONFIRMED'), {}, workspaceTrade('FUNDED'));
    const { container } = show();
    const rows = await screen.findByLabelText('Protected payment');
    expect(within(rows).getByText('Protected amount').nextElementSibling?.textContent).toBe('₦458,780.00');
    expect(within(rows).getByText(REFERENCE)).toBeTruthy();
    expect(within(rows).getByText('Protected')).toBeTruthy();
    expect(within(rows).getByText('Held until settlement')).toBeTruthy();
    expect(screen.getByText('Dispatch is now eligible')).toBeTruthy();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('CWT-S07: says no protected state exists, lists what was tried, and offers to try again or go back', async () => {
    serve(status('NOT_CONFIRMED'));
    const { container } = show();
    expect(await screen.findByText(/No protected-funds state has been created/)).toBeTruthy();
    const rows = screen.getByLabelText('Payment');
    expect(within(rows).getByText('₦458,780.00')).toBeTruthy();
    expect(within(rows).getByText(REFERENCE)).toBeTruthy();
    expect(within(rows).getByText('Not confirmed')).toBeTruthy();
    expect(within(rows).getByText('Awaiting funding')).toBeTruthy();
    expect(screen.getByText(/Do not dispatch/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try payment again' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Return to trade' }).getAttribute('href')).toBe(
      `/trade/${id(1)}`,
    );
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

describe('F-023 review: the money paths', () => {
  it('CWT-S07: checking again is the primary action and survives; starting again needs a confirmation that names the risk', async () => {
    serve(status('NOT_CONFIRMED'), {
      'POST /trades/:code/payment/confirm': status('VERIFYING'),
      'POST /trades/:code/payment/initiate': initiated(),
    });
    show();
    const buttons = (await screen.findAllByRole('button')).map((b) => b.textContent);
    expect(buttons.indexOf("I've sent it — check again")).toBeLessThan(buttons.indexOf('Try payment again'));
    fireEvent.click(screen.getByRole('button', { name: 'Try payment again' }));
    expect(await screen.findByText(/the one you already used stops being valid/)).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/:code/payment/initiate')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    fireEvent.click(screen.getByRole('button', { name: "I've sent it — check again" }));
    await waitFor(() => expect(callsTo(api.call, 'POST', '/trades/:code/payment/confirm')).toHaveLength(1));
    expect(callsTo(api.call, 'POST', '/trades/:code/payment/initiate')).toHaveLength(0);
  });

  it.each([
    ['FUNDED', /Dispatch is now eligible/, 'Held until settlement', 'Funds protected'],
    ['SHIPPED', null, 'Held until settlement', 'Funds protected'],
    ['SETTLED', null, 'Paid', 'Payment released'],
    ['RESOLVED_RELEASED', null, 'Paid', 'Payment released'],
    ['RESOLVED_REFUNDED', null, 'Not paid', 'Payment refunded'],
    ['CANCELLED_REFUNDED', null, 'Not paid', 'Payment refunded'],
  ])('CWT-S06 on %s says only what is true of that status', async (tradeStatus, dispatch, payout, hero) => {
    serve(status('CONFIRMED'), {}, workspaceTrade(tradeStatus));
    show();
    expect(await screen.findByRole('heading', { level: 2, name: hero })).toBeTruthy();
    const rows = screen.getByLabelText('Protected payment');
    expect(within(rows).getByText(payout)).toBeTruthy();
    if (dispatch === null) expect(screen.queryByText('Dispatch is now eligible')).toBeNull();
    else expect(screen.getByText('Dispatch is now eligible')).toBeTruthy();
    if (tradeStatus !== 'FUNDED' && tradeStatus !== 'SHIPPED') {
      expect(screen.queryByText(/still not released/)).toBeNull();
      expect(screen.queryByText(/is now held in escrow/)).toBeNull();
    }
  });

  it('CWT-S04: the three amounts come from the attempt once there is one, and add up', async () => {
    serve(
      status('AWAITING_PAYMENT', {
        status: 'INITIATED',
        amountMinor: '46000000',
        itemAmountMinor: '45300000',
        buyerProtectionFeeMinor: '700000',
      }),
    );
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to payment' }));
    const fees = await screen.findByLabelText('What you pay');
    expect(within(fees).getByText('Amount').nextElementSibling?.textContent).toBe('₦453,000.00');
    expect(within(fees).getByText('Buyer Protection Fee').nextElementSibling?.textContent).toBe('₦7,000.00');
    expect(within(fees).getByText('Total').nextElementSibling?.textContent).toBe('₦460,000.00');
  });

  it('CWT-S04: repeats the seller delivery charge disclosure before the buyer commits', async () => {
    serve(
      status('NONE'),
      {},
      workspaceTrade('PENDING_PAYMENT', 'BUYER', {
        terms: {
          ...workspaceTrade('PENDING_PAYMENT').terms,
          itemSpec: { brand: 'Apple', deliveryMode: 'COURIER', deliveryChargeMinor: '250000' },
        },
      }),
    );
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to payment' }));
    await screen.findByRole('heading', { level: 1, name: 'Review Payment' });
    expect(screen.getByText(/outside Komtru protection and is not part of this total/)).toBeTruthy();
  });

  it('holds the card button until the checkout is open, so a second tap opens no second one', async () => {
    serve(status('NONE'), { 'POST /trades/:code/payment/initiate': initiated() });
    let release: () => void = () => undefined;
    const opened: PaystackInline[] = [];
    const slow: Checkout = {
      open: (setup) => {
        opened.push(setup);
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    };
    renderWithApi(api.call, <FundTrade id={id(1)} checkout={slow} />);
    fireEvent.click(await screen.findByLabelText(/Debit card or USSD/));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    const pay = await screen.findByRole('button', { name: 'Confirm & pay' });
    fireEvent.click(pay);
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Confirm & pay' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & pay' }));
    expect(opened).toHaveLength(1);
    expect(callsTo(api.call, 'POST', '/trades/:code/payment/initiate')).toHaveLength(1);
    release();
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Confirm & pay' }).disabled).toBe(false),
    );
  });
});
