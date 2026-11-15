// @vitest-environment jsdom
// F-030 / CT1 and CT2: cancelling a trade nobody has been confirmed to have paid for. The screen must not say
// "no money has moved" for a buyer whose bank transfer could still land, so the payment status gates the button.
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CancelTrade } from '../src/trade/cancel/CancelTrade';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  answerWith,
  callsTo,
  id,
  paymentRead,
  renderWithApi,
  workspaceTrade,
  type CallFn,
} from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
afterEach(cleanup);
beforeEach(() => {
  api.call.mockReset();
});

const problem = (code: string, status: number, detail?: string) =>
  new ProblemError(
    { type: 'about:blank', title: 'x', status, code, ...(detail === undefined ? {} : { detail }) },
    { status, requestId: undefined, replayed: false, retryAfterMs: undefined, rateLimit: undefined },
    false,
  );

const serve = (trade: unknown, more: Record<string, unknown> = {}) => {
  answerWith(api.call, { 'GET /trades/:id': trade, ...more });
  return renderWithApi(api.call, <CancelTrade id={id(1)} />);
};

const cancelButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Yes, cancel this trade' });

describe('CT1 cancel this trade (before payment)', () => {
  it('lets a buyer with no payment started cancel, with an optional reason, then shows CT2', async () => {
    const { container } = serve(workspaceTrade('PENDING_PAYMENT', 'BUYER'), {
      'GET /trades/:code/payment/status': paymentRead('NONE'),
      'POST /trades/:id/cancel': workspaceTrade('CANCELLED', 'BUYER', {
        acceptedAt: '2026-09-30T08:41:00.000Z',
      }),
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Cancel this trade?' })).toBeTruthy();
    expect(await screen.findByText(/No payment has been started on this trade/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Why are you cancelling? (optional)'), {
      target: { value: '  Found it elsewhere  ' },
    });
    await expectNoAxeViolations(container, SHELL_RULES);
    fireEvent.click(cancelButton());
    expect(await screen.findByRole('heading', { name: 'Trade cancelled' })).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/:id/cancel')[0]).toMatchObject({
      params: { id: id(1) },
      body: { reason: 'Found it elsewhere' },
    });
    expect(screen.queryByRole('button', { name: 'Yes, cancel this trade' })).toBeNull();
  });

  it('sends no reason when the box is left empty', async () => {
    serve(workspaceTrade('PENDING_PAYMENT', 'BUYER'), {
      'GET /trades/:code/payment/status': paymentRead('NONE'),
      'POST /trades/:id/cancel': workspaceTrade('CANCELLED', 'BUYER'),
    });
    await screen.findByText(/No payment has been started/);
    fireEvent.click(cancelButton());
    await screen.findByRole('heading', { name: 'Trade cancelled' });
    expect(callsTo(api.call, 'POST', '/trades/:id/cancel')[0]?.body).toEqual({});
  });

  it('holds the cancel until the buyer says no money was sent, when a payment attempt is open', async () => {
    serve(workspaceTrade('PENDING_PAYMENT', 'BUYER'), {
      'GET /trades/:code/payment/status': paymentRead('AWAITING_PAYMENT'),
      'POST /trades/:id/cancel': workspaceTrade('CANCELLED', 'BUYER'),
    });
    expect(await screen.findByText(/You started a payment that hasn’t been confirmed/)).toBeTruthy();
    expect(screen.queryByText(/No payment has been started/)).toBeNull();
    expect(cancelButton().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('I haven’t sent any money for this trade'));
    expect(cancelButton().disabled).toBe(false);
    fireEvent.click(cancelButton());
    expect(await screen.findByRole('heading', { name: 'Trade cancelled' })).toBeTruthy();
  });

  it.each(['VERIFYING', 'CONFIRMED', 'UNDER_REVIEW', 'NOT_CONFIRMED'])(
    'offers no cancel when the payment is %s, because money may have landed or still can',
    async (displayState) => {
      const { container } = serve(workspaceTrade('PENDING_PAYMENT', 'BUYER'), {
        'GET /trades/:code/payment/status': paymentRead(displayState),
      });
      expect(await screen.findByText(/A payment on this trade may already have reached Komtru/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Yes, cancel this trade' })).toBeNull();
      expect(screen.queryByText(/No payment has been started/)).toBeNull();
      expect(screen.getByRole('link', { name: 'Open the trade' }).getAttribute('href')).toBe(
        `/trade/${id(1)}`,
      );
      expect(callsTo(api.call, 'POST', '/trades/:id/cancel')).toHaveLength(0);
      await expectNoAxeViolations(container, SHELL_RULES);
    },
  );

  it('offers no cancel when the payment status cannot be read, and reads it again on request', async () => {
    let attempts = 0;
    serve(workspaceTrade('PENDING_PAYMENT', 'BUYER'), {
      'GET /trades/:code/payment/status': () => {
        attempts += 1;
        if (attempts === 1) throw problem('INTERNAL', 500);
        return paymentRead('NONE');
      },
    });
    expect(await screen.findByText(/We couldn’t check whether a payment is on its way/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Yes, cancel this trade' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Yes, cancel this trade' })).toBeTruthy();
  });

  it('does not read the payment for the seller, and says only what the trade status proves', async () => {
    serve(workspaceTrade('PENDING_PAYMENT', 'SELLER'), {
      'POST /trades/:id/cancel': workspaceTrade('CANCELLED', 'SELLER'),
    });
    expect(await screen.findByText(/Komtru hasn’t confirmed a payment on this trade/)).toBeTruthy();
    expect(screen.queryByText(/No payment has been started/)).toBeNull();
    expect(callsTo(api.call, 'GET', '/trades/:code/payment/status')).toHaveLength(0);
    fireEvent.click(cancelButton());
    expect(await screen.findByRole('heading', { name: 'Trade cancelled' })).toBeTruthy();
  });

  it('says why when the platform refuses, keeps the screen, and does not claim it is cancelled', async () => {
    serve(workspaceTrade('PENDING_PAYMENT', 'BUYER'), {
      'GET /trades/:code/payment/status': paymentRead('NONE'),
      'POST /trades/:id/cancel': problem('INVALID_TRANSITION', 409),
    });
    await screen.findByText(/No payment has been started/);
    fireEvent.click(cancelButton());
    expect(await screen.findByText(/This trade has moved on since you opened it/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Trade cancelled' })).toBeNull();
  });
});
