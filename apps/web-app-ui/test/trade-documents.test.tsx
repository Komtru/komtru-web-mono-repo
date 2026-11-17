// @vitest-environment jsdom
// F-044 (SP-M11): receipt and documents for a Trade. Every figure is the Trade's own fee snapshot as the platform sent it,
// and the screen says only what it holds: no PDF, no retention period, no share.
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TradeDocuments } from '../src/trade/documents/TradeDocuments';
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
beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const read = inspectionRead({
  status: 'SETTLED',
  deliveryEvidence: {
    signals: [{ source: 'SELLER_SELF_REPORT', reportedAt: '2026-10-03T12:24:00.000Z' }],
    selfArranged: null,
  },
});

const serve = (trade: unknown, more: Record<string, unknown> = {}) => {
  answerWith(api.call, { 'GET /trades/:id': trade, 'GET /trades/:id/inspection': read, ...more });
  return renderWithApi(api.call, <TradeDocuments id={id(1)} />);
};

describe('Receipt & documents (SP-M11)', () => {
  it('lists the agreement, the receipt and the delivery proof of a completed Trade, for the buyer', async () => {
    const { container } = serve(workspaceTrade('SETTLED', 'BUYER'));
    expect(await screen.findByRole('heading', { name: 'Documents' })).toBeDefined();
    const docs = await screen.findByRole('list', { name: 'Documents for this Trade' });
    const agreement = within(docs).getByRole('link', { name: /Agreement/ });
    expect(agreement.getAttribute('href')).toBe(`/trade/${id(1)}/agreement`);
    expect(agreement.textContent).toContain('Version 2');
    expect(await within(docs).findByText(/2 photos or videos/)).toBeDefined();
    const proof = within(docs).getByRole('link', { name: /Delivery proof/ });
    expect(proof.getAttribute('href')).toBe(`/trade/${id(1)}/record`);
    expect(proof.textContent).toContain('2 photos or videos');
    const receipt = screen.getByRole('region', { name: 'Receipt' });
    expect(within(receipt).getByText('Item')).toBeDefined();
    expect(within(receipt).getByText('₦452,000.00')).toBeDefined();
    expect(within(receipt).getByText('Buyer protection fee')).toBeDefined();
    expect(within(receipt).getByText('₦6,780.00')).toBeDefined();
    expect(within(receipt).getByText('You paid')).toBeDefined();
    expect(within(receipt).getByText('₦458,780.00')).toBeDefined();
    expect(within(receipt).getByText('KMT-9042800-NG')).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('shows the seller what they receive, from the same snapshot, and no buyer protection fee line', async () => {
    serve(workspaceTrade('SETTLED', 'SELLER'));
    const receipt = await screen.findByRole('region', { name: 'Receipt' });
    expect(within(receipt).getByText('You receive')).toBeDefined();
    expect(within(receipt).queryByText('Buyer protection fee')).toBeNull();
    expect(within(receipt).queryByText('You paid')).toBeNull();
  });

  it('offers to print or save the receipt as a PDF through the browser, and promises nothing more', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    serve(workspaceTrade('SETTLED', 'BUYER'));
    fireEvent.click(await screen.findByRole('button', { name: 'Print or save as PDF' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/12 months/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download all' })).toBeNull();
    print.mockRestore();
  });

  it('says a Trade that ended in a refund decision did, and points to where the money is', async () => {
    serve(workspaceTrade('RESOLVED_REFUNDED', 'BUYER'));
    expect(await screen.findByText('Refund decided')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Where’s my refund?' }).getAttribute('href')).toBe(
      '/account/refunds',
    );
  });

  it('is not there until the Trade is complete', async () => {
    const { container } = serve(workspaceTrade('INSPECTION', 'BUYER'));
    expect(await screen.findByText('Documents are there once the Trade is complete')).toBeDefined();
    expect(screen.queryByRole('region', { name: 'Receipt' })).toBeNull();
    expect(api.call.mock.calls.some(([endpoint]) => endpoint.path === '/trades/:id/inspection')).toBe(false);
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('shows loading while the Trade is read', async () => {
    api.call.mockImplementation(() => new Promise(() => undefined));
    const { container } = renderWithApi(api.call, <TradeDocuments id={id(1)} />);
    expect(screen.getByLabelText('Loading the trade')).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says the delivery proof could not be read, and keeps the receipt', async () => {
    const { container } = serve(workspaceTrade('SETTLED', 'BUYER'), {
      'GET /trades/:id/inspection': new Error('boom'),
    });
    expect(await screen.findByText(/We couldn’t load the delivery proof/)).toBeDefined();
    expect(screen.getByRole('region', { name: 'Receipt' })).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says offline in the person’s words when the Trade cannot be read with no network', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const { container } = serve(workspaceTrade('SETTLED', 'BUYER'), { 'GET /trades/:id': new Error('boom') });
    expect(await screen.findByText('You’re offline')).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
    online.mockRestore();
  });

  it('says there is no snapshot of the money when the Trade carries none, and does not invent one', async () => {
    serve(workspaceTrade('SETTLED', 'BUYER', { fees: null }));
    expect(await screen.findByText('The receipt isn’t available for this Trade.')).toBeDefined();
    expect(screen.queryByText('You paid')).toBeNull();
  });
});
