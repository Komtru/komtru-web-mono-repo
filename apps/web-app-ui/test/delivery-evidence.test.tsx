// @vitest-environment jsdom
// F-028 / CWT-S12: Evidence - Trade Media, by event, from what the platform can list.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
    'GET /trades/:id/evidence': { items: [], nextCursor: null },
    'GET /files/:id': (input: { params?: { id?: string } }) => ({
      ...fileRead(7),
      fileId: input.params?.id ?? id(7),
    }),
    ...more,
  });
  return renderWithApi(api.call, <Evidence id={id(1)} />);
};

describe('CWT-S12 / PM-6 trade media', () => {
  it('shows the proof as it was when agreed, then what was added beside it, and says plainly where nothing was added', async () => {
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
    expect(
      await screen.findByText('Photos you add at inspection are kept here, with the trade.'),
    ).toBeTruthy();
    expect(screen.getByText(/Chat attachments can be linked to the trade/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add evidence' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/evidence/new`,
    );
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('shows the seller their own waybill receipt under dispatch, and not the buyer’s inspection photos', async () => {
    serve(workspaceTrade('SHIPPED', 'SELLER'));
    const dispatch = await screen.findByRole('region', { name: 'Dispatch' });
    expect(await within(dispatch).findByAltText('Waybill receipt')).toBeTruthy();
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

const file = (n: number, event: string, role: 'BUYER' | 'SELLER' = 'BUYER') => ({
  id: id(800 + n),
  fileId: id(700 + n),
  event,
  attachedByRole: role,
  attachedAt: `2026-11-17T10:0${String(n)}:00.000Z`,
});
const byEvent = (rows: ReturnType<typeof file>[]) => (input: { query?: Record<string, unknown> }) => ({
  items: rows.filter((row) => row.event === input.query?.event),
  nextCursor: null,
});

describe('CWT-S12 media added by the parties (CWT-S13)', () => {
  it('fills the delivery and inspection groups from the new read, each file saying who added it', async () => {
    const { container } = serve(workspaceTrade('INSPECTION', 'BUYER'), {
      'GET /trades/:id/evidence': byEvent([
        file(1, 'DELIVERY', 'SELLER'),
        file(2, 'DELIVERY'),
        file(3, 'INSPECTION'),
      ]),
    });
    const delivery = await screen.findByRole('region', { name: 'Delivery' });
    await waitFor(() => {
      expect(within(delivery).getAllByRole('img')).toHaveLength(2);
    });
    expect(within(delivery).getByAltText('Delivery file 1, added by the seller')).toBeTruthy();
    expect(within(delivery).getByText(/2 files · shared with both sides of the trade/)).toBeTruthy();
    const inspection = screen.getByRole('region', { name: 'Inspection' });
    expect(await within(inspection).findByAltText('Inspection file 1, added by the buyer')).toBeTruthy();
    expect(within(inspection).getByText(/1 file · shared/)).toBeTruthy();
    // An event with no files and nothing else to say is not drawn.
    expect(screen.queryByRole('region', { name: 'Issue' })).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('draws the issue group and dispatch files only when there are some', async () => {
    serve(workspaceTrade('DISPUTED', 'SELLER'), {
      'GET /trades/:id/inspection': inspectionRead({ deliveryEvidence: { signals: [], selfArranged: null } }),
      'GET /trades/:id/evidence': byEvent([file(1, 'ISSUE'), file(2, 'DISPATCH', 'SELLER')]),
    });
    const issue = await screen.findByRole('region', { name: 'Issue' });
    expect(await within(issue).findByAltText('Issue file 1, added by the buyer')).toBeTruthy();
    const dispatch = screen.getByRole('region', { name: 'Dispatch' });
    expect(await within(dispatch).findByAltText('Dispatch file 1, added by the seller')).toBeTruthy();
  });

  it('says plainly when nothing was added, and offers Add evidence only while the trade can take it', async () => {
    serve(workspaceTrade('INSPECTION', 'SELLER'));
    expect(await screen.findByText('Nothing has been added at delivery yet.')).toBeTruthy();
    expect(screen.getByText('Nothing has been added at inspection yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add evidence' })).toBeTruthy();
    cleanup();
    serve(workspaceTrade('COMPLETED', 'SELLER'));
    await screen.findByRole('region', { name: 'Seller’s proof' });
    expect(screen.queryByRole('link', { name: 'Add evidence' })).toBeNull();
  });

  it('shows a failed read of one group as a failure with a retry, not as no files, and keeps the rest', async () => {
    let fail = true;
    serve(workspaceTrade('INSPECTION', 'BUYER'), {
      'GET /trades/:id/evidence': (input: { query?: Record<string, unknown> }) => {
        if (input.query?.event === 'DELIVERY' && fail) return new Error('boom');
        return { items: [], nextCursor: null };
      },
    });
    expect(await screen.findByText('We couldn’t load the delivery files.')).toBeTruthy();
    expect(screen.queryByText('Nothing has been added at delivery yet.')).toBeNull();
    expect(screen.getByRole('region', { name: 'Seller’s proof' })).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Nothing has been added at delivery yet.')).toBeTruthy();
  });

  it('says a failed read in the words of the connection when the device is offline', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    serve(workspaceTrade('INSPECTION', 'BUYER'), { 'GET /trades/:id/evidence': new Error('boom') });
    expect((await screen.findAllByText(/You’re offline, so we can’t load the delivery files/)).length).toBe(
      1,
    );
    online.mockRestore();
  });
});
