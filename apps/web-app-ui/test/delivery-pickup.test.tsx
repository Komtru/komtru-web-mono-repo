// @vitest-environment jsdom
// F-028 / CWT-S11: Delivery - Park Pickup, built for the self-arranged path only (Park is out of the MVP).
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pickup } from '../src/trade/delivery/Pickup';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  answerWith,
  id,
  inspectionRead,
  renderWithApi,
  workspaceTrade,
  type CallFn,
} from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
afterEach(cleanup);
beforeEach(() => {
  api.call.mockReset();
});

const serve = (trade: unknown, more: Record<string, unknown> = {}) => {
  answerWith(api.call, { 'GET /trades/:id': trade, 'GET /trades/:id/inspection': inspectionRead(), ...more });
  return renderWithApi(api.call, <Pickup id={id(1)} />);
};

describe('CWT-S11 delivery details (self-arranged)', () => {
  it('tells the buyer who is delivering where, with no PIN and no hub', async () => {
    const { container } = serve(workspaceTrade('SHIPPED', 'BUYER'));
    expect(await screen.findByText('Waybill KT-883192')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Delivery Details' })).toBeTruthy();
    expect(screen.getByText(/There is no release PIN/)).toBeTruthy();
    expect(screen.getByText('Delivery to you')).toBeTruthy();
    expect(screen.queryByText(/Park Hub|Release PIN|482/)).toBeNull();
    expect(screen.getByText(/48 hours of inspection time starts when you confirm/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to trade' }).getAttribute('href')).toBe(`/trade/${id(1)}`);
    expect(screen.getByRole('link', { name: 'Track the delivery' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/track`,
    );
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('words it for the seller, and says nothing is handed over before dispatch', async () => {
    serve(workspaceTrade('FUNDED', 'SELLER'));
    expect(await screen.findByText(/You are arranging this delivery/)).toBeTruthy();
    expect(screen.getByText('Not handed over yet')).toBeTruthy();
    expect(screen.getByText('Delivery to the buyer')).toBeTruthy();
  });

  it('has nothing to show before payment or after receipt', async () => {
    serve(workspaceTrade('PENDING_PAYMENT', 'BUYER'));
    expect(await screen.findByText(/no delivery details to show/)).toBeTruthy();
    cleanup();
    serve(workspaceTrade('INSPECTION', 'BUYER'));
    expect(await screen.findByText(/This item has been received/)).toBeTruthy();
  });

  it('says the shipment could not be loaded, and an error or offline read of the trade', async () => {
    serve(workspaceTrade('SHIPPED', 'BUYER'), { 'GET /trades/:id/inspection': new Error('boom') });
    expect(await screen.findByText(/We couldn't load the shipment details/)).toBeTruthy();
    cleanup();
    answerWith(api.call, { 'GET /trades/:id': new Error('down') });
    renderWithApi(api.call, <Pickup id={id(1)} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(await screen.findByText('Couldn’t load this trade')).toBeTruthy();
  });
});
