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

describe('CWT-S12 / PM-6 trade media', () => {
  it('shows the proof as it was when agreed, then what was added beside it, and keeps the unlisted events honest', async () => {
    const { container } = serve(workspaceTrade('INSPECTION', 'BUYER'), {
      'GET /trades/:id/inspection': inspectionRead({
        deliveryEvidence: {
          signals: [{ source: 'SELLER_SELF_REPORT', reportedAt: '2026-10-03T12:24:00.000Z' }],
          selfArranged: withReceipt.deliveryEvidence.selfArranged,
        },
      }),
    });
    const proof = await screen.findByRole('region', { name: 'Seller’s proof' });
    expect(within(proof).getByText('Shown when the Trade was agreed')).toBeTruthy();
    await waitFor(() => {
      expect(within(proof).getAllByRole('img')).toHaveLength(2);
    });
    expect(within(proof).getByText(/Anything added after that is shown beside it, not over it/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Trade Evidence' })).toBeTruthy();
    // The page only declines to draw the seller's waybill receipt for the buyer; the file itself is protected by the
    // platform (the buyer holds no access grant on it), not by this screen.
    const dispatch = screen.getByRole('region', { name: 'Dispatch' });
    expect(within(dispatch).getByText(/Waybill KT-883192 .* the waybill photo is kept private/)).toBeTruthy();
    expect(within(dispatch).queryByRole('img')).toBeNull();
    expect(screen.getByText('Added at delivery')).toBeTruthy();
    expect(screen.getByText(/Reported delivered by the seller/)).toBeTruthy();
    expect(screen.getByText('Your inspection photos')).toBeTruthy();
    expect(screen.getByText(/aren’t kept with the Trade yet/)).toBeTruthy();
    expect(screen.getByText(/Chat attachments can be linked to the trade/)).toBeTruthy();
    // No add-evidence control: the platform has nothing to attach it to yet.
    expect(screen.queryByRole('link', { name: /Add evidence/ })).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('shows the seller their own waybill receipt under dispatch, and not the buyer’s inspection photos', async () => {
    serve(workspaceTrade('SHIPPED', 'SELLER'));
    const dispatch = await screen.findByRole('region', { name: 'Dispatch' });
    expect(await within(dispatch).findByAltText('Waybill receipt')).toBeTruthy();
    expect(screen.queryByText('Your inspection photos')).toBeNull();
  });

  it('says so when no proof was attached', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'), {
      'GET /trades/:id/inspection': inspectionRead({ sellerProof: { media: [] } }),
    });
    expect(await screen.findByText('No proof photos were attached to this trade.')).toBeTruthy();
  });

  it('shows the evidence of a trade resolved after a dispute, as the platform allows', async () => {
    serve(workspaceTrade('RESOLVED_REFUNDED', 'BUYER'));
    expect(await screen.findByRole('region', { name: 'Seller’s proof' })).toBeTruthy();
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
