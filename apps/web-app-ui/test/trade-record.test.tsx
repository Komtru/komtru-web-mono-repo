// @vitest-environment jsdom
// F-029, PM-8: the media kept with a completed trade. It draws what the platform recorded and says plainly what it has
// not, with loading, error, offline and not-yet-complete states.
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TradeRecord } from '../src/trade/proof/EvidenceTrail';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  answerWith,
  fileRead,
  id,
  inspectionRead,
  renderWithApi,
  workspaceTrade,
  type CallFn,
} from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const dispatch = {
  waybillNumber: 'KT-883192',
  shippedAt: '2026-10-01T09:20:00.000Z',
  receiptFileId: id(9),
  vehiclePlate: 'LSR123AB',
};
const read = inspectionRead({
  status: 'SETTLED',
  deliveryEvidence: {
    signals: [{ source: 'SELLER_SELF_REPORT', reportedAt: '2026-10-03T12:24:00.000Z' }],
    selfArranged: dispatch,
  },
});

const serve = (trade: unknown, more: Record<string, unknown> = {}) => {
  answerWith(api.call, {
    'GET /trades/:id': trade,
    'GET /trades/:id/inspection': read,
    'GET /files/:id': (input: { params?: { id?: string } }) => ({
      ...fileRead(7),
      fileId: input.params?.id ?? id(7),
    }),
    ...more,
  });
  return renderWithApi(api.call, <TradeRecord id={id(1)} />);
};

describe('PM-8: the Trade record', () => {
  it('lists what is kept, shows the proof, and says only what the platform does', async () => {
    const { container } = serve(workspaceTrade('SETTLED', 'BUYER'));
    expect(await screen.findByText('Completed')).toBeTruthy();
    const kept = screen.getByLabelText('Evidence kept with this Trade');
    expect(within(kept).getByText('2 photos or videos')).toBeTruthy();
    // The waybill photo is the seller's: the buyer is told only that the waybill is noted.
    expect(within(kept).getByText('Waybill noted')).toBeTruthy();
    expect(within(kept).getByText('1 record')).toBeTruthy();
    expect(screen.getByText(/held privately with the Trade/)).toBeTruthy();
    expect(screen.queryByText(/12 months/)).toBeNull();
    expect(screen.getByRole('link', { name: 'View all evidence' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/evidence`,
    );
    expect(screen.getByRole('link', { name: 'Back to Trades' }).getAttribute('href')).toBe('/trades');
    await waitFor(() => {
      expect(screen.getAllByRole('img').length).toBeGreaterThan(0);
    });
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('counts the seller’s own waybill photo for the seller', async () => {
    serve(workspaceTrade('SETTLED', 'SELLER'));
    expect(await screen.findByText('1 photo · waybill')).toBeTruthy();
  });

  it('does not call a trade "Refunded" when the status only means a refund was decided', async () => {
    serve(workspaceTrade('RESOLVED_REFUNDED', 'BUYER'));
    expect(await screen.findByText('Refund decided')).toBeTruthy();
    expect(screen.queryByText('Refunded')).toBeNull();
  });

  it('is not there until the Trade is complete, and points to the evidence so far', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'));
    expect(await screen.findByText('The record is there once the Trade is complete')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View all evidence' })).toBeTruthy();
    expect(api.call.mock.calls.some(([e]) => e.path === '/trades/:id/inspection')).toBe(false);
  });

  it('shows loading, then a retryable error, and says so when the device is offline', async () => {
    serve(workspaceTrade('SETTLED', 'BUYER'), { 'GET /trades/:id/inspection': new Error('boom') });
    expect(screen.getByLabelText('Loading the trade')).toBeTruthy();
    expect(await screen.findByText('Couldn’t load the record')).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    cleanup();
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    serve(workspaceTrade('SETTLED', 'BUYER'), { 'GET /trades/:id/inspection': new Error('boom') });
    expect(await screen.findByText('You’re offline')).toBeTruthy();
    online.mockRestore();
  });
});
