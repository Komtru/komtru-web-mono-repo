// @vitest-environment jsdom
// F-028 / CWT-S10: Delivery - Tracking and Custody, from what the platform records of a self-arranged delivery.
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Track } from '../src/trade/delivery/Track';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  answerWith,
  deliveryDeadline,
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
  answerWith(api.call, {
    'GET /trades/:id': trade,
    'GET /trades/:id/inspection': inspectionRead(),
    'GET /trades/:id/delivery-deadline': deliveryDeadline('2026-11-14T17:00:00.000Z'),
    ...more,
  });
  return renderWithApi(api.call, <Track id={id(1)} />);
};

describe('CWT-S10 tracking and custody', () => {
  it('shows the buyer a parcel in transit: tracking, last update, expected date and who has it', async () => {
    const { container } = serve(workspaceTrade('SHIPPED', 'BUYER'));
    expect(await screen.findByText('Tracking KT-883192')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Track Order' })).toBeTruthy();
    expect(screen.getByText('In transit', { selector: 'b' })).toBeTruthy();
    expect(screen.getByText(/Handed to the courier ·/)).toBeTruthy();
    expect(screen.getByText('LSR123AB')).toBeTruthy();
    expect(await screen.findByText(/^By /)).toBeTruthy();
    const steps = within(screen.getByRole('list', { name: 'Custody timeline' }));
    expect(steps.getByText('Seller')).toBeTruthy();
    expect(steps.getByText('Handover complete')).toBeTruthy();
    expect(steps.getByText('Not received')).toBeTruthy();
    // No hub custody in the MVP.
    expect(screen.queryByText(/Park Hub/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Delivery details' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/pickup`,
    );
    expect(screen.getByRole('link', { name: 'Back to trade' }).getAttribute('href')).toBe(`/trade/${id(1)}`);
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says a funded trade has not been handed over, and reads no shipment', async () => {
    serve(workspaceTrade('FUNDED', 'BUYER'));
    expect(await screen.findByText('Not handed over yet')).toBeTruthy();
    expect(screen.getByText('Preparing the handover')).toBeTruthy();
    expect(api.call.mock.calls.some(([e]) => e.path === '/trades/:id/inspection')).toBe(false);
  });

  it('puts the buyer last on the timeline once the seller reports delivery, and calls the seller "You"', async () => {
    serve(workspaceTrade('UNCONFIRMED_DELIVERY', 'SELLER'));
    expect(await screen.findByText('Delivery reported')).toBeTruthy();
    expect(screen.getByText('Waiting to confirm')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
  });

  it('refuses a trade that has nothing to track', async () => {
    serve(workspaceTrade('PENDING_PAYMENT', 'BUYER'));
    expect(await screen.findByText('There is nothing to track on this trade.')).toBeTruthy();
  });

  it('says the shipment could not be loaded and tries again, while the timeline still shows', async () => {
    serve(workspaceTrade('SHIPPED', 'BUYER'), { 'GET /trades/:id/inspection': new Error('boom') });
    expect(await screen.findByText(/We couldn't load the shipment details/)).toBeTruthy();
    expect(screen.getByText('Handover complete')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  });

  it('says no tracking is recorded when the platform has none', async () => {
    serve(workspaceTrade('SHIPPED', 'BUYER'), {
      'GET /trades/:id/inspection': inspectionRead({
        deliveryEvidence: { signals: [], selfArranged: null },
      }),
    });
    expect(await screen.findByText('No tracking recorded yet')).toBeTruthy();
  });

  it('shows loading, then the offline words when the trade cannot be read without a connection', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    answerWith(api.call, { 'GET /trades/:id': new Error('network') });
    renderWithApi(api.call, <Track id={id(1)} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(await screen.findByText('You’re offline')).toBeTruthy();
    online.mockRestore();
  });
});
