// @vitest-environment jsdom
// F-028 / CWT-S08: Delivery - Dispatch Readiness. The guard is the trade's status; self-arranged path only.
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dispatch } from '../src/trade/delivery/Dispatch';
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
beforeEach(() => {
  api.call.mockReset();
});

const show = (trade: unknown) => {
  answerWith(api.call, { 'GET /trades/:id': trade });
  return renderWithApi(api.call, <Dispatch id={id(1)} />);
};

describe('CWT-S08 dispatch readiness', () => {
  it('shows the seller a protected payment, the terms and a checklist reminder', async () => {
    const { container } = show(workspaceTrade('FUNDED', 'SELLER'));
    expect(await screen.findByText('Payment is protected')).toBeTruthy();
    expect(screen.getByText('Confirm the delivery route before handing the item over.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Ready to Dispatch' })).toBeTruthy();
    expect(screen.getByText('Arranged by you')).toBeTruthy();
    expect(screen.getByText('48 hours minimum')).toBeTruthy();
    // No Park, no courier fee, no PIN: the MVP is the seller's own arrangement.
    expect(screen.queryByText(/Park|PIN|Delivery charge/)).toBeNull();
    // The checklist is the seller's own reminder: ticking it does not unlock the way on, which is always open.
    const tick = screen.getByLabelText<HTMLInputElement>('Package sealed and labelled');
    fireEvent.click(tick);
    expect(tick.checked).toBe(true);
    expect(screen.getByRole('link', { name: 'Add waybill details' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/dispatch/waybill`,
    );
    expect(screen.getByRole('link', { name: 'View agreement' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/terms`,
    );
    expect(screen.getByLabelText<HTMLInputElement>('Dispatch allowed').disabled).toBe(true);
    expect(
      screen.getByText(
        'If payment is not protected, dispatch stays locked. This guard is enforced server-side.',
      ),
    ).toBeTruthy();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('locks dispatch before the payment is protected and offers no way on', async () => {
    const { container } = show(workspaceTrade('PENDING_PAYMENT', 'SELLER'));
    expect(await screen.findByText(/Dispatch locked · Awaiting payment/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Dispatch locked' }).disabled).toBe(true);
    expect(screen.queryByText('Payment is protected')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Add waybill details' })).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('points a seller whose item has already gone to tracking', async () => {
    show(workspaceTrade('SHIPPED', 'SELLER'));
    expect(await screen.findByText('This item has already been handed over.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Track the delivery' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/track`,
    );
  });

  it('lets a seller whose trade has shipped report the delivery, and then says it was reported', async () => {
    answerWith(api.call, {
      'GET /trades/:id': workspaceTrade('SHIPPED', 'SELLER'),
      'POST /trades/:id/report-delivered': workspaceTrade('UNCONFIRMED_DELIVERY', 'SELLER'),
    });
    renderWithApi(api.call, <Dispatch id={id(1)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Report delivery' }));
    expect(await screen.findByRole('heading', { name: 'Delivery reported' })).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/:id/report-delivered')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Report delivery' })).toBeNull();
  });

  it('refuses the buyer in words, with nothing to press (permission denied)', async () => {
    const { container } = show(workspaceTrade('FUNDED', 'BUYER'));
    expect(await screen.findByText(/Only the seller dispatches a trade/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('shows a loading state, then an error with a retry that reads the trade again', async () => {
    answerWith(api.call, {
      'GET /trades/:id': new ProblemError(
        { type: 'about:blank', title: 'x', status: 500, code: 'INTERNAL' },
        { status: 500, requestId: undefined, replayed: false, retryAfterMs: undefined, rateLimit: undefined },
        false,
      ),
    });
    renderWithApi(api.call, <Dispatch id={id(1)} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(await screen.findByText('Couldn’t load this trade')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await screen.findByText('Couldn’t load this trade');
    expect(api.call.mock.calls.length).toBeGreaterThan(1);
  });

  it('says the device is offline when the read fails without a connection', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    answerWith(api.call, { 'GET /trades/:id': new Error('network') });
    renderWithApi(api.call, <Dispatch id={id(1)} />);
    expect(await screen.findByText('You’re offline')).toBeTruthy();
    online.mockRestore();
  });
});
