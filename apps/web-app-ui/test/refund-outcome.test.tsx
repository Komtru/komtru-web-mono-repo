// @vitest-environment jsdom
// F-030 / CR3, SC2 and the plain refund: a CANCELLED_REFUNDED trade says only what ITS refund row says. The money
// lines are the ledger's, shown as sent; "issued" is said only for a PROCESSED refund.
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RefundOutcome } from '../src/trade/cancel/RefundOutcome';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  answerWith,
  cancellationRead,
  cancellationRequest,
  refundRow,
  refundsRead,
  renderWithApi,
  workspaceTrade,
  type CallFn,
} from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
afterEach(cleanup);
beforeEach(() => {
  api.call.mockReset();
});

const buyerApproved = cancellationRead('CANCELLED_REFUNDED', 'BUYER', {
  refundRequested: true,
  request: cancellationRequest({ status: 'APPROVED' }),
});
const sellerCancelled = (role: 'BUYER' | 'SELLER') =>
  cancellationRead('CANCELLED_REFUNDED', role, {
    refundRequested: true,
    request: cancellationRequest({ requestedByRole: 'SELLER', reason: 'OUT_OF_STOCK', status: 'APPROVED' }),
  });

const show = (role: 'BUYER' | 'SELLER', refunds: unknown, read: unknown) => {
  answerWith(api.call, { 'GET /trades/:id/refunds': refunds, 'GET /trades/:id/cancellation': read });
  const trade = workspaceTrade('CANCELLED_REFUNDED', role);
  return renderWithApi(api.call, <RefundOutcome trade={trade} role={role} />);
};

describe('CR3 refund (buyer, cancellation approved)', () => {
  it('says a PROCESSED refund is issued, and shows the ledger’s own amounts', async () => {
    const { container } = show('BUYER', refundsRead(refundRow('PROCESSED')), buyerApproved);
    expect(await screen.findByRole('heading', { name: 'Refund issued in full' })).toBeTruthy();
    expect(screen.getByText(/₦458,780\.00 was sent back to your original payment method/)).toBeTruthy();
    expect(screen.getByText(/Amaka B\. approved your cancellation request/)).toBeTruthy();
    const rows = within(screen.getByLabelText('The refund'));
    expect(rows.getByText('₦458,780.00')).toBeTruthy();
    expect(rows.getByText('₦452,000.00')).toBeTruthy();
    expect(rows.getByText(/₦6,780\.00 · Returned with your refund/)).toBeTruthy();
    expect(rows.getByText('refund-501')).toBeTruthy();
    // No arrival time the platform has not promised.
    expect(screen.queryByText(/within 2 hours|within 24/)).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it.each(['REQUESTED', 'PROCESSING'] as const)(
    'does not say issued while the refund is %s',
    async (status) => {
      show('BUYER', refundsRead(refundRow(status)), buyerApproved);
      expect(await screen.findByRole('heading', { name: 'Refund on its way' })).toBeTruthy();
      expect(screen.getByText(/is being sent back to your original payment method/)).toBeTruthy();
      expect(screen.queryByText(/Refund issued/)).toBeNull();
      expect(screen.queryByText(/was sent back/)).toBeNull();
    },
  );

  it.each(['FAILED', 'NEEDS_REVIEW'] as const)(
    'says only what the refund row says when it is %s: the platform’s reason and the reference, with no claim about where the money is',
    async (status) => {
      show(
        'BUYER',
        refundsRead(refundRow(status, { failureReason: 'Your bank returned the payment.' })),
        buyerApproved,
      );
      expect(await screen.findByRole('heading', { name: 'Your refund hasn’t completed' })).toBeTruthy();
      expect(screen.queryByText(/not lost|held by Komtru/)).toBeNull();
      expect(screen.getByText(/Your bank returned the payment\./)).toBeTruthy();
      expect(screen.getAllByText(/refund-501/).length).toBeGreaterThan(0);
      expect(screen.queryByText(/Refund issued/)).toBeNull();
      expect(screen.queryByText(/was sent back/)).toBeNull();
    },
  );

  it('says the fee was kept, with no amount, when the platform returns a zero fee because it kept it', async () => {
    show(
      'BUYER',
      refundsRead(
        refundRow('PROCESSED', {
          amountMinor: '45200000',
          feeAmountMinor: '0',
          buyerProtectionFeeTreatment: 'RECOGNISE',
        }),
      ),
      buyerApproved,
    );
    const rows = within(await screen.findByLabelText('The refund'));
    expect(rows.getByText('Buyer protection fee')).toBeTruthy();
    expect(rows.getByText('Kept by Komtru')).toBeTruthy();
  });

  it('hides the fee row when the fee amount is zero', async () => {
    show('BUYER', refundsRead(refundRow('PROCESSED', { feeAmountMinor: '0' })), buyerApproved);
    const rows = within(await screen.findByLabelText('The refund'));
    // A zero fee that was returned has nothing to explain.
    expect(rows.queryByText('Buyer protection fee')).toBeNull();
  });
});

describe('SC2 seller couldn’t fulfil', () => {
  it('tells the buyer who, why, and where the refund stands', async () => {
    show(
      'BUYER',
      refundsRead(refundRow('PROCESSED', { reason: 'SELLER_CANNOT_FULFIL' })),
      sellerCancelled('BUYER'),
    );
    expect(await screen.findByRole('heading', { name: 'Amaka B. couldn’t fulfil this' })).toBeTruthy();
    expect(screen.getByText(/Reason given: out of stock\./)).toBeTruthy();
    expect(screen.getByText(/₦458,780\.00 was sent back to your original payment method/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start a new trade' }).getAttribute('href')).toBe('/trade/new');
  });

  it('does not tell the buyer the refund is sent while it is still processing', async () => {
    show('BUYER', refundsRead(refundRow('PROCESSING')), sellerCancelled('BUYER'));
    expect(await screen.findByRole('heading', { name: 'Amaka B. couldn’t fulfil this' })).toBeTruthy();
    expect(screen.getByText(/is being sent back to your original payment method/)).toBeTruthy();
    expect(screen.queryByText(/was sent back/)).toBeNull();
  });

  it('does not tell the seller the trade is "refunded" while the refund is still moving', async () => {
    show(
      'SELLER',
      refundsRead(refundRow('PROCESSING')),
      cancellationRead('CANCELLED_REFUNDED', 'SELLER', {
        refundRequested: true,
        request: cancellationRequest({ status: 'APPROVED' }),
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Cancelled after payment' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Cancelled and refunded' })).toBeNull();
  });

  it('shows the seller their own cancellation and the refund’s state, with no amounts or fees', async () => {
    show('SELLER', refundsRead(refundRow('PROCESSED')), sellerCancelled('SELLER'));
    expect(await screen.findByRole('heading', { name: 'You cancelled this trade' })).toBeTruthy();
    expect(screen.getByText(/refund has been sent/)).toBeTruthy();
    expect(screen.queryByLabelText('The refund')).toBeNull();
    expect(screen.queryByText(/₦6,780/)).toBeNull();
    expect(screen.queryByText(/₦458,780/)).toBeNull();
  });
});

describe('a refund the screen can not vouch for', () => {
  it('says nothing about money when a refunded trade has no refund row', async () => {
    show('BUYER', refundsRead(), cancellationRead('CANCELLED_REFUNDED', 'BUYER', { refundRequested: true }));
    expect(await screen.findByText(/can’t see the refund details yet/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Cancelled after payment' })).toBeTruthy();
    expect(screen.queryByLabelText('The refund')).toBeNull();
    expect(screen.queryByText(/refunded|sent back|issued/i)).toBeNull();
  });

  it('says the refund could not be loaded, claims no amount, and reads again on request', async () => {
    let attempts = 0;
    show(
      'BUYER',
      () => {
        attempts += 1;
        if (attempts === 1) {
          throw new ProblemError(
            { type: 'about:blank', title: 'x', status: 500, code: 'INTERNAL' },
            {
              status: 500,
              requestId: undefined,
              replayed: false,
              retryAfterMs: undefined,
              rateLimit: undefined,
            },
            false,
          );
        }
        return refundsRead(refundRow('PROCESSED'));
      },
      buyerApproved,
    );
    expect(await screen.findByText(/We couldn’t load the refund details/)).toBeTruthy();
    expect(screen.queryByText(/₦458,780/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Refund issued in full' })).toBeTruthy();
  });

  it('words an overdue-delivery refund from the platform’s own reason, with no request involved', async () => {
    show(
      'BUYER',
      refundsRead(refundRow('PROCESSED', { reason: 'DELIVERY_OVERDUE' })),
      cancellationRead('CANCELLED_REFUNDED', 'BUYER', { refundRequested: true }),
    );
    expect(await screen.findByRole('heading', { name: 'Refund issued in full' })).toBeTruthy();
    expect(screen.getByText(/delivery date passed without the item shipping/)).toBeTruthy();
  });
});
