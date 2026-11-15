// @vitest-environment jsdom
// F-030 / CR1 and SC1: cancelling a funded trade. Every button comes from the platform's `actions`, every refusal is
// said in words, and nothing here names a refund amount (that is the ledger's, shown on the outcome).
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CancelTrade } from '../src/trade/cancel/CancelTrade';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  answerWith,
  callsTo,
  cancellationRead,
  cancellationRequest,
  id,
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

const serve = (trade: unknown, read: unknown, more: Record<string, unknown> = {}) => {
  answerWith(api.call, {
    'GET /trades/:id': trade,
    'GET /trades/:id/cancellation': read,
    ...more,
  });
  return renderWithApi(api.call, <CancelTrade id={id(1)} />);
};

describe('CR1 request cancellation (buyer, funded)', () => {
  const buyer = () => workspaceTrade('FUNDED', 'BUYER');
  const open = () => cancellationRead('FUNDED', 'BUYER', { actions: { canRequest: true } });
  const send = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Send cancellation request' });

  it('asks for a reason, sends it once, and then says the request is waiting', async () => {
    let read: unknown = open();
    const { container } = serve(buyer(), () => read, {
      'POST /trades/:id/cancellation-request': () => {
        read = cancellationRead('FUNDED', 'BUYER', {
          request: cancellationRequest({ reason: 'FOUND_CHEAPER' }),
        });
        return cancellationRequest({ reason: 'FOUND_CHEAPER' });
      },
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Request cancellation' })).toBeTruthy();
    expect(screen.getByText(/Your payment is protected in escrow/)).toBeTruthy();
    // No refund amount (the ledger's, shown on the outcome) and no deadline the platform has not built.
    expect(screen.queryByText(/refund(ed)? of/i)).toBeNull();
    expect(screen.queryByText(/12 hours/)).toBeNull();
    expect(send().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Found it elsewhere for less'));
    expect(send().disabled).toBe(false);
    await expectNoAxeViolations(container, SHELL_RULES);
    fireEvent.click(send());
    expect(await screen.findByRole('heading', { name: 'Request sent' })).toBeTruthy();
    expect(screen.getByText(/Found it elsewhere for less/)).toBeTruthy();
    const sent = callsTo(api.call, 'POST', '/trades/:id/cancellation-request');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ params: { id: id(1) }, body: { reason: 'FOUND_CHEAPER' } });
    expect(screen.queryByRole('button', { name: 'Send cancellation request' })).toBeNull();
  });

  it('says the platform refused, in its words, and keeps the form so the buyer can try again', async () => {
    serve(buyer(), open(), {
      'POST /trades/:id/cancellation-request': problem('CONFLICT', 409, 'The item has already shipped.'),
    });
    fireEvent.click(await screen.findByLabelText('Changed my mind'));
    fireEvent.click(send());
    expect(await screen.findByText('The item has already shipped.')).toBeTruthy();
    expect(send()).toBeTruthy();
  });

  it('shows a waiting request with no way to ask again', async () => {
    serve(buyer(), cancellationRead('FUNDED', 'BUYER', { request: cancellationRequest() }));
    expect(await screen.findByRole('heading', { name: 'Request sent' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send cancellation request' })).toBeNull();
  });

  it('says a declined request ends here, with the seller note, and promises no refund', async () => {
    serve(
      buyer(),
      cancellationRead('FUNDED', 'BUYER', {
        request: cancellationRequest({ status: 'DECLINED', responseNote: 'Already with the courier.' }),
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Request declined' })).toBeTruthy();
    expect(screen.getByText(/Already with the courier\./)).toBeTruthy();
    expect(screen.queryByText(/refund/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send cancellation request' })).toBeNull();
  });

  it('says a refund is already on the way when one was requested, and offers no request', async () => {
    serve(
      buyer(),
      cancellationRead('FUNDED', 'BUYER', {
        refundRequested: true,
        request: cancellationRequest({ status: 'APPROVED' }),
      }),
    );
    expect(await screen.findByText(/A refund has been requested for this trade/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send cancellation request' })).toBeNull();
  });

  it('offers nothing and claims nothing for a trade the platform will not cancel (held, or no action open)', async () => {
    serve(buyer(), cancellationRead('FUNDED', 'BUYER'));
    expect(await screen.findByText(/can’t be cancelled right now/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send cancellation request' })).toBeNull();
  });

  it('says a shipped trade is past cancelling, from the trade status', async () => {
    serve(workspaceTrade('SHIPPED', 'BUYER'), cancellationRead('SHIPPED', 'BUYER'));
    expect(await screen.findByText(/only possible before the item ships/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send cancellation request' })).toBeNull();
  });

  it('points an already refunded trade at the trade, and says nothing about an amount', async () => {
    serve(
      workspaceTrade('CANCELLED_REFUNDED', 'BUYER'),
      cancellationRead('CANCELLED_REFUNDED', 'BUYER', { refundRequested: true }),
    );
    expect(await screen.findByText(/cancelled after payment/)).toBeTruthy();
    expect(screen.queryByText(/₦/)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says it cannot load the options and reads again on request', async () => {
    let attempts = 0;
    serve(buyer(), () => {
      attempts += 1;
      if (attempts === 1) throw problem('INTERNAL', 500);
      return open();
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Request cancellation' })).toBeTruthy();
  });
});

describe('SC1 cancel, can’t fulfil (seller, funded)', () => {
  const seller = () => workspaceTrade('FUNDED', 'SELLER');
  const open = (over: Record<string, unknown> = {}) =>
    cancellationRead('FUNDED', 'SELLER', { actions: { canCancelAsSeller: true }, ...over });
  const cancelAndRefund = () =>
    screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel & refund buyer' });

  it('asks again in a sheet before an irreversible refund, then sends the reason', async () => {
    let read: unknown = open();
    const { container } = serve(seller(), () => read, {
      'POST /trades/:id/cannot-fulfil': () => {
        read = cancellationRead('FUNDED', 'SELLER', {
          refundRequested: true,
          request: cancellationRequest({
            requestedByRole: 'SELLER',
            reason: 'OUT_OF_STOCK',
            status: 'APPROVED',
          }),
        });
        return cancellationRequest({ requestedByRole: 'SELLER', reason: 'OUT_OF_STOCK', status: 'APPROVED' });
      },
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Cancel this trade' })).toBeTruthy();
    expect(await screen.findByText(/there’s no review step/)).toBeTruthy();
    expect(cancelAndRefund().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Out of stock'));
    await expectNoAxeViolations(container, SHELL_RULES);
    fireEvent.click(cancelAndRefund());
    const sheet = await screen.findByRole('dialog');
    expect(callsTo(api.call, 'POST', '/trades/:id/cannot-fulfil')).toHaveLength(0);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel and refund' }));
    expect(await screen.findByRole('heading', { name: 'You cancelled this trade' })).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/:id/cannot-fulfil')[0]).toMatchObject({
      params: { id: id(1) },
      body: { reason: 'OUT_OF_STOCK' },
    });
  });

  it('shows the buyer’s waiting request with a way to answer it', async () => {
    serve(
      seller(),
      open({ actions: { canCancelAsSeller: true, canRespond: true }, request: cancellationRequest() }),
    );
    const link = await screen.findByRole('link', { name: 'Review the request' });
    expect(link.getAttribute('href')).toBe(`/trade/${id(1)}/cancel-request`);
  });

  it('offers no can’t-fulfil to a seller whose trade has shipped', async () => {
    serve(workspaceTrade('SHIPPED', 'SELLER'), cancellationRead('SHIPPED', 'SELLER'));
    expect(await screen.findByText(/only possible before the item ships/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel & refund buyer' })).toBeNull();
  });

  it('does not say a refund started when the platform has not started one', async () => {
    serve(seller(), cancellationRead('FUNDED', 'SELLER'));
    expect(await screen.findByText(/can’t be cancelled right now/)).toBeTruthy();
    expect(screen.queryByText(/refund has started/)).toBeNull();
  });
});
