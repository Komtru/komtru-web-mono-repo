// @vitest-environment jsdom
// F-030: what the trade overview says about a cancellation in progress (the funded trade) and AR1, a payment the
// inspection window released by itself. Both read the platform for THIS trade and stay silent when they can't.
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoReleaseNotice } from '../src/trade/cancel/AutoReleaseNotice';
import { CancellationNotice } from '../src/trade/cancel/CancellationNotice';
import {
  activityRow,
  answerWith,
  cancellationRead,
  cancellationRequest,
  id,
  page,
  renderWithApi,
  workspaceTrade,
  type CallFn,
} from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
afterEach(cleanup);
beforeEach(() => {
  api.call.mockReset();
});

describe('CancellationNotice (a funded trade with a cancellation in progress)', () => {
  const show = (role: 'BUYER' | 'SELLER', read: unknown) => {
    answerWith(api.call, { 'GET /trades/:id/cancellation': read });
    return renderWithApi(api.call, <CancellationNotice trade={workspaceTrade('FUNDED', role)} />);
  };

  it('tells the seller a request is waiting and links to answer it', async () => {
    show(
      'SELLER',
      cancellationRead('FUNDED', 'SELLER', {
        actions: { canCancelAsSeller: true, canRespond: true },
        request: cancellationRequest(),
      }),
    );
    expect(await screen.findByText(/Amaka B\. asked to cancel this trade/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Review the request' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/cancel-request`,
    );
  });

  it('tells the buyer their request is waiting, without a deadline or an auto-approval', async () => {
    show('BUYER', cancellationRead('FUNDED', 'BUYER', { request: cancellationRequest() }));
    expect(await screen.findByText(/You asked to cancel/)).toBeTruthy();
    expect(screen.queryByText(/12|auto/i)).toBeNull();
  });

  it('says a refund has been requested, for either side, instead of leaving the funds looking untouched', async () => {
    show(
      'BUYER',
      cancellationRead('FUNDED', 'BUYER', {
        refundRequested: true,
        request: cancellationRequest({ status: 'APPROVED' }),
      }),
    );
    expect(await screen.findByText(/A refund has been requested for this trade/)).toBeTruthy();
  });

  it('says nothing when there is no request and no refund', async () => {
    const { container } = show(
      'BUYER',
      cancellationRead('FUNDED', 'BUYER', { actions: { canRequest: true } }),
    );
    await vi.waitFor(() => {
      expect(api.call).toHaveBeenCalled();
    });
    expect(container.textContent).toBe('');
  });

  it('says nothing when the cancellation cannot be read', async () => {
    const { container } = show('BUYER', new Error('boom'));
    await vi.waitFor(() => {
      expect(api.call).toHaveBeenCalled();
    });
    expect(container.textContent).toBe('');
  });
});

describe('AR1 payment released automatically', () => {
  const show = (status: string, role: 'BUYER' | 'SELLER', rows: unknown[] | Error) => {
    answerWith(api.call, { 'GET /trades/:id/activity': rows instanceof Error ? rows : page(rows) });
    return renderWithApi(api.call, <AutoReleaseNotice trade={workspaceTrade(status, role)} />);
  };
  const elapsed = activityRow(2, { kind: 'INSPECTION_ELAPSED', toStatus: 'COMPLETED', actor: 'KOMTRU' });

  it('tells the buyer the payment is being released, while the trade is only COMPLETED', async () => {
    show('COMPLETED', 'BUYER', [elapsed]);
    expect(await screen.findByText('Payment released automatically')).toBeTruthy();
    expect(screen.getByText(/48-hour inspection window closed without a response/)).toBeTruthy();
    expect(screen.getByText(/₦452,000 is being released to Amaka B\./)).toBeTruthy();
    expect(screen.queryByText(/was released/)).toBeNull();
  });

  it('says released only once the trade is SETTLED', async () => {
    show('SETTLED', 'BUYER', [elapsed]);
    expect(await screen.findByText(/₦452,000 was released to Amaka B\./)).toBeTruthy();
  });

  it('tells the seller their own proceeds from the trade snapshot', async () => {
    show('COMPLETED', 'SELLER', [elapsed]);
    expect(await screen.findByText(/₦452,000 is being released to you/)).toBeTruthy();
  });

  it('says nothing for a payment the buyer released themselves', async () => {
    const { container } = show('SETTLED', 'BUYER', [activityRow(1, { kind: 'TRADE_COMPLETED' })]);
    await vi.waitFor(() => {
      expect(api.call).toHaveBeenCalled();
    });
    expect(container.textContent).toBe('');
  });

  it('says nothing when the activity cannot be read', async () => {
    const { container } = show('SETTLED', 'BUYER', new Error('boom'));
    await vi.waitFor(() => {
      expect(api.call).toHaveBeenCalled();
    });
    expect(container.textContent).toBe('');
  });
});
