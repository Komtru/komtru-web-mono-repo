// @vitest-environment jsdom
// F-030 / CT2: "nothing to settle" is said only when the buyer's own payment status allows it. A transfer that landed
// after the cancel (confirmed, verifying, under review) must not be told there is nothing to settle.
import { ProblemError } from '@komtru/api-client';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TradeCancelled } from '../src/trade/cancel/TradeCancelled';
import {
  answerWith,
  callsTo,
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

const show = (role: 'BUYER' | 'SELLER', payment: unknown) => {
  answerWith(api.call, { 'GET /trades/:code/payment/status': payment });
  return renderWithApi(api.call, <TradeCancelled trade={workspaceTrade('CANCELLED', role)} justNow />);
};

describe('CT2 trade cancelled', () => {
  it.each(['NONE', 'AWAITING_PAYMENT'])(
    'says there is nothing to settle when the payment is %s',
    async (state) => {
      show('BUYER', paymentRead(state));
      expect(
        await screen.findByText(/never confirmed a payment on this trade, so there is nothing to settle/),
      ).toBeTruthy();
    },
  );

  it.each(['VERIFYING', 'CONFIRMED', 'UNDER_REVIEW', 'NOT_CONFIRMED'])(
    'does not say there is nothing to settle when the payment is %s: it asks the buyer to contact support',
    async (state) => {
      show('BUYER', paymentRead(state));
      expect(await screen.findByText(/may have reached Komtru/)).toBeTruthy();
      expect(screen.queryByText(/nothing to settle/)).toBeNull();
      expect(screen.getByText(/KMT-9042800-NG/)).toBeTruthy();
    },
  );

  it('does not say it while the payment is loading, or when it cannot be read', async () => {
    show(
      'BUYER',
      new ProblemError(
        { type: 'about:blank', title: 'x', status: 500, code: 'INTERNAL' },
        { status: 500, requestId: undefined, replayed: false, retryAfterMs: undefined, rateLimit: undefined },
        false,
      ),
    );
    expect(await screen.findByText(/cancelled before it was funded/)).toBeTruthy();
    expect(screen.queryByText(/nothing to settle/)).toBeNull();
  });

  it('says only the status to the seller, and reads no payment', async () => {
    show('SELLER', paymentRead('NONE'));
    expect(await screen.findByText(/cancelled before it was funded/)).toBeTruthy();
    expect(screen.queryByText(/nothing to settle/)).toBeNull();
    expect(callsTo(api.call, 'GET', '/trades/:code/payment/status')).toHaveLength(0);
  });
});
