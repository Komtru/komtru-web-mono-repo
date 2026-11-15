// @vitest-environment jsdom
// F-030 / CR2: the seller answers the buyer's cancellation request. Approving refunds the buyer and cannot be undone,
// so it asks once; declining is the plain decline the platform has (no TrustOps hold, no auto-approval).
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewRequest } from '../src/trade/cancel/ReviewRequest';
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
  answerWith(api.call, { 'GET /trades/:id': trade, 'GET /trades/:id/cancellation': read, ...more });
  return renderWithApi(api.call, <ReviewRequest id={id(1)} />);
};

const pending = () =>
  cancellationRead('FUNDED', 'SELLER', {
    actions: { canCancelAsSeller: true, canRespond: true },
    request: cancellationRequest({ note: 'Sorry, plans changed' }),
  });

describe('CR2 buyer wants to cancel (seller)', () => {
  it('shows the request, the reason and the note, and promises nothing the platform has not built', async () => {
    const { container } = serve(workspaceTrade('FUNDED', 'SELLER'), pending());
    expect(await screen.findByRole('heading', { level: 1, name: 'Cancellation request' })).toBeTruthy();
    expect(await screen.findByText(/Changed my mind/)).toBeTruthy();
    expect(screen.getByText(/Sorry, plans changed/)).toBeTruthy();
    expect(screen.queryByText(/auto-approved|12h|12 hours|TrustOps/i)).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('asks once before approving, then sends the approval for this request and says the refund has started', async () => {
    let read: unknown = pending();
    serve(workspaceTrade('FUNDED', 'SELLER'), () => read, {
      'POST /trades/:id/cancellation-request/:requestId/approve': () => {
        read = cancellationRead('FUNDED', 'SELLER', {
          refundRequested: true,
          request: cancellationRequest({ status: 'APPROVED' }),
        });
        return cancellationRequest({ status: 'APPROVED' });
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve — refund buyer' }));
    const sheet = await screen.findByRole('dialog');
    expect(callsTo(api.call, 'POST', '/trades/:id/cancellation-request/:requestId/approve')).toHaveLength(0);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Approve and refund' }));
    expect(await screen.findByRole('heading', { name: 'You agreed to cancel' })).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/:id/cancellation-request/:requestId/approve')[0]).toMatchObject(
      {
        params: { id: id(1), requestId: id(401) },
      },
    );
    expect(screen.getByText(/refund has started/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve — refund buyer' })).toBeNull();
  });

  it('declines with an optional note, as a plain decline', async () => {
    let read: unknown = pending();
    serve(workspaceTrade('FUNDED', 'SELLER'), () => read, {
      'POST /trades/:id/cancellation-request/:requestId/decline': () => {
        read = cancellationRead('FUNDED', 'SELLER', {
          actions: { canCancelAsSeller: true },
          request: cancellationRequest({ status: 'DECLINED', responseNote: 'Already shipped' }),
        });
        return cancellationRequest({ status: 'DECLINED', responseNote: 'Already shipped' });
      },
    });
    fireEvent.change(await screen.findByLabelText('Note to the buyer (optional)'), {
      target: { value: ' Already shipped ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Decline — I’ve already shipped' }));
    expect(await screen.findByRole('heading', { name: 'You declined the request' })).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/:id/cancellation-request/:requestId/decline')[0]).toMatchObject(
      {
        params: { id: id(1), requestId: id(401) },
        body: { note: 'Already shipped' },
      },
    );
  });

  it('keeps the question open and says why when the platform refuses', async () => {
    serve(workspaceTrade('FUNDED', 'SELLER'), pending(), {
      'POST /trades/:id/cancellation-request/:requestId/decline': problem(
        'CONFLICT',
        409,
        'This request was already answered.',
      ),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Decline — I’ve already shipped' }));
    expect(await screen.findByText('This request was already answered.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve — refund buyer' })).toBeTruthy();
  });

  it('offers no answer when there is nothing to answer, or it has lapsed', async () => {
    serve(
      workspaceTrade('SHIPPED', 'SELLER'),
      cancellationRead('SHIPPED', 'SELLER', { request: cancellationRequest({ status: 'LAPSED' }) }),
    );
    expect(await screen.findByText(/no longer waiting for an answer/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('refuses the buyer, in words, with nothing to press', async () => {
    serve(
      workspaceTrade('FUNDED', 'BUYER'),
      cancellationRead('FUNDED', 'BUYER', { request: cancellationRequest() }),
    );
    expect(await screen.findByText(/Only the seller can answer/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
