// @vitest-environment jsdom
// F-029, PM-6 and PM-8: the evidence a trade holds, and the record kept after completion. Each draws what the
// platform recorded and says plainly what it has not, and every data-backed screen has its loading, error, offline
// and refused states.
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EvidenceTrail, TradeRecord } from '../src/trade/proof/EvidenceTrail';
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
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const problem = (code: string, status: number) =>
  new ProblemError(
    { type: 'about:blank', title: 'Reworded', status, code },
    { status, requestId: undefined, replayed: false, retryAfterMs: undefined, rateLimit: undefined },
    false,
  );

const dispatch = {
  waybillNumber: 'KT-883192',
  shippedAt: '2026-10-01T09:20:00.000Z',
  receiptFileId: id(9),
  vehiclePlate: 'LSR123AB',
};

const serve = (trade: unknown, read: unknown = inspectionRead(), more: Record<string, unknown> = {}) =>
  answerWith(api.call, {
    'GET /trades/:id': trade,
    'GET /trades/:id/inspection': read,
    'GET /files/:id': (input: { params?: Record<string, string> }) =>
      fileRead(Number(input.params?.id?.slice(-1))),
    ...more,
  });

describe('PM-6: the evidence trail', () => {
  it('shows the fixed proof, then what was added at dispatch and at delivery, each with who and when', async () => {
    serve(
      workspaceTrade('INSPECTION', 'BUYER'),
      inspectionRead({
        deliveryEvidence: {
          signals: [{ source: 'SELLER_SELF_REPORT', reportedAt: '2026-10-03T12:24:00.000Z' }],
          selfArranged: dispatch,
        },
      }),
    );
    const { container } = renderWithApi(api.call, <EvidenceTrail id={id(1)} />);
    expect(await screen.findByText('Fixed when the Trade was agreed')).toBeTruthy();
    const proof = await screen.findByLabelText('Seller’s proof', { selector: 'ul' });
    await waitFor(() => {
      expect(within(proof).getAllByRole('img')).toHaveLength(2);
    });
    expect(screen.getByText(/It can’t be changed or removed/)).toBeTruthy();
    expect(screen.getByText('Added by the seller · dispatch')).toBeTruthy();
    expect(screen.getByText(/Waybill KT-883192 .* waybill photo included/)).toBeTruthy();
    expect(screen.getByText('Added at delivery')).toBeTruthy();
    expect(screen.getByText(/Reported delivered by the seller/)).toBeTruthy();
    expect(screen.getByText('Your inspection photos')).toBeTruthy();
    expect(screen.getByText(/aren’t kept with the Trade yet/)).toBeTruthy();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('does not offer the buyer’s inspection photos to the seller', async () => {
    serve(workspaceTrade('INSPECTION', 'SELLER'));
    renderWithApi(api.call, <EvidenceTrail id={id(1)} />);
    await screen.findByText('Fixed when the Trade was agreed');
    expect(screen.queryByText('Your inspection photos')).toBeNull();
  });

  it('says how many files there are, and that they open once shipped, before the item has shipped', async () => {
    serve(workspaceTrade('FUNDED', 'SELLER', { proofMediaCount: 3 }));
    renderWithApi(api.call, <EvidenceTrail id={id(1)} />);
    expect(await screen.findByText('3 photos or videos shown')).toBeTruthy();
    expect(api.call.mock.calls.some(([endpoint]) => endpoint.path === '/trades/:id/inspection')).toBe(false);
  });

  it('says so when no proof was attached', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'), inspectionRead({ sellerProof: { media: [] } }));
    renderWithApi(api.call, <EvidenceTrail id={id(1)} />);
    expect(await screen.findByText('No proof was attached to this Trade.')).toBeTruthy();
  });

  it('shows loading, then a way to try again when it cannot be read', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'), problem('INTERNAL', 500));
    renderWithApi(api.call, <EvidenceTrail id={id(1)} />);
    expect(screen.getByLabelText('Loading the trade')).toBeTruthy();
    expect(await screen.findByText('Couldn’t open the evidence')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => {
      expect(api.call.mock.calls.filter(([e]) => e.path === '/trades/:id/inspection').length).toBeGreaterThan(
        1,
      );
    });
  });

  it('says, without a retry, when the person is not in the Trade', async () => {
    serve(problem('FORBIDDEN', 403));
    renderWithApi(api.call, <EvidenceTrail id={id(1)} />);
    expect(await screen.findByText('Only the people in this Trade can see its evidence')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('says so when the device is offline', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    serve(workspaceTrade('FUNDED', 'BUYER'));
    renderWithApi(api.call, <EvidenceTrail id={id(1)} />);
    expect(await screen.findByText('You’re offline')).toBeTruthy();
  });
});

describe('PM-8: the Trade record', () => {
  it('lists what is kept, shows the proof and says who can see it', async () => {
    serve(
      workspaceTrade('SETTLED', 'BUYER'),
      inspectionRead({
        status: 'SETTLED',
        deliveryEvidence: {
          signals: [{ source: 'SELLER_SELF_REPORT', reportedAt: '2026-10-03T12:24:00.000Z' }],
          selfArranged: dispatch,
        },
      }),
    );
    const { container } = renderWithApi(api.call, <TradeRecord id={id(1)} />);
    expect(await screen.findByText('Completed')).toBeTruthy();
    const kept = screen.getByLabelText('Evidence kept with this Trade');
    expect(within(kept).getByText('2 photos or videos')).toBeTruthy();
    expect(within(kept).getByText('1 photo · waybill')).toBeTruthy();
    expect(within(kept).getByText('1 record')).toBeTruthy();
    expect(screen.getByText(/Only the two people in the Trade and Komtru can see it/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View all evidence' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/evidence`,
    );
    expect(screen.getByRole('link', { name: 'Back to Trades' }).getAttribute('href')).toBe('/trades');
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('is not there until the Trade is complete, and points to the evidence so far', async () => {
    serve(workspaceTrade('INSPECTION', 'BUYER'));
    renderWithApi(api.call, <TradeRecord id={id(1)} />);
    expect(await screen.findByText('The record is kept when the Trade is complete')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View all evidence' })).toBeTruthy();
  });

  it('says so when it cannot be read', async () => {
    serve(workspaceTrade('SETTLED', 'BUYER'), problem('INTERNAL', 500));
    renderWithApi(api.call, <TradeRecord id={id(1)} />);
    expect(await screen.findByText('Couldn’t open the evidence')).toBeTruthy();
  });
});
