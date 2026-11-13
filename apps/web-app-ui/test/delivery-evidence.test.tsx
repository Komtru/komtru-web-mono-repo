// @vitest-environment jsdom
// F-028 / CWT-S12: Evidence - Trade Media, by event, from what the platform can list.
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Evidence } from '../src/trade/delivery/Evidence';
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
afterEach(cleanup);
beforeEach(() => {
  api.call.mockReset();
});

const withReceipt = inspectionRead({
  deliveryEvidence: {
    signals: [],
    selfArranged: { waybillNumber: 'KT-883192', shippedAt: '2026-09-30T12:18:00.000Z', receiptFileId: id(9) },
  },
});

const serve = (trade: unknown, more: Record<string, unknown> = {}) => {
  answerWith(api.call, {
    'GET /trades/:id': trade,
    'GET /trades/:id/inspection': withReceipt,
    'GET /files/:id': (input: { params?: { id?: string } }) => ({
      ...fileRead(7),
      fileId: input.params?.id ?? id(7),
    }),
    ...more,
  });
  return renderWithApi(api.call, <Evidence id={id(1)} />);
};

describe('CWT-S12 trade media', () => {
  it('groups the seller’s proof under Listing with its real count, and keeps the unlisted events honest', async () => {
    const { container } = serve(workspaceTrade('INSPECTION', 'BUYER'));
    const listing = await screen.findByRole('region', { name: 'Listing' });
    expect(within(listing).getByText('Listing · 2 files')).toBeTruthy();
    await waitFor(() => {
      expect(within(listing).getAllByRole('img')).toHaveLength(2);
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Trade Evidence' })).toBeTruthy();
    expect(screen.getByText('Dispatch · 0 files')).toBeTruthy();
    // The waybill receipt is the seller's private evidence: the buyer is not shown it.
    expect(screen.getByText('The seller’s waybill receipt is kept private.')).toBeTruthy();
    expect(screen.getByText('Delivery · 0 files')).toBeTruthy();
    expect(screen.getByText('No files recorded for inspection.')).toBeTruthy();
    expect(screen.getByText(/Chat attachments can be linked to the trade/)).toBeTruthy();
    // No add-evidence control: the platform has nothing to attach it to yet.
    expect(screen.queryByRole('link', { name: /Add evidence/ })).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('shows the seller their own waybill receipt under Dispatch', async () => {
    serve(workspaceTrade('SHIPPED', 'SELLER'));
    const dispatch = await screen.findByRole('region', { name: 'Dispatch' });
    expect(within(dispatch).getByText('Dispatch · 1 file')).toBeTruthy();
    expect(await within(dispatch).findByAltText('Waybill receipt')).toBeTruthy();
  });

  it('says a trade that has not shipped has no evidence yet', async () => {
    serve(workspaceTrade('FUNDED', 'SELLER'));
    expect(await screen.findByText(/Evidence appears here once the item has shipped/)).toBeTruthy();
    expect(api.call.mock.calls.some(([e]) => e.path === '/trades/:id/inspection')).toBe(false);
  });

  it('shows loading and then a retryable error, offline in its own words', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'), { 'GET /trades/:id/inspection': new Error('boom') });
    expect(screen.getByRole('status')).toBeTruthy();
    expect(await screen.findByText('Couldn’t load the evidence')).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    cleanup();
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    serve(workspaceTrade('INSPECTION', 'BUYER'), { 'GET /trades/:id/inspection': new Error('boom') });
    expect(await screen.findByText('You’re offline')).toBeTruthy();
    online.mockRestore();
  });
});
