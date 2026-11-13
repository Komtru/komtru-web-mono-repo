// @vitest-environment jsdom
// CWT-S01 (Agreed Terms) and CWT-S02 (Agreement History): the authoritative agreement and the versions it went
// through, read from the trade and drawn for both people.
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgreementHistory } from '../src/trade/terms/AgreementHistory';
import { TradePolicies } from '../src/trade/terms/TradePolicies';
import { AgreementScreen } from '../src/trade/terms/AgreementScreen';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  activityRow,
  answerWith,
  id,
  page,
  renderWithApi,
  workspaceTrade,
  type CallFn,
} from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const problem = (code: string, status: number) =>
  new ProblemError(
    { type: 'about:blank', title: 'Reworded', status, code },
    { status, requestId: undefined, replayed: false, retryAfterMs: undefined, rateLimit: undefined },
    false,
  );

const versionEvents = [
  activityRow(1, {
    kind: 'PROPOSAL_SENT',
    actor: 'YOU',
    toStatus: null,
    occurredAt: '2026-09-29T08:00:00.000Z',
  }),
  activityRow(2, {
    kind: 'TERMS_CHANGED',
    actor: 'OTHER_PARTY',
    toStatus: null,
    occurredAt: '2026-09-29T09:30:00.000Z',
  }),
];
const serve = (trade: unknown, activity: unknown = page(versionEvents)) =>
  answerWith(api.call, { 'GET /trades/:id': trade, 'GET /trades/:id/activity': activity });

describe('CWT-S01 Agreed Terms', () => {
  it('names the authoritative version, the item, the other party and the locked commercial terms', async () => {
    serve(workspaceTrade('PENDING_PAYMENT', 'BUYER'));
    renderWithApi(api.call, <AgreementScreen id={id(1)} />);
    expect(await screen.findByText(/authoritative agreement/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Agreed Terms' })).toBeTruthy();
    expect(screen.getByText('Version 2 is the authoritative agreement for this trade.')).toBeTruthy();
    expect(screen.getByText('Apple iPhone 13 Pro')).toBeTruthy();
    expect(screen.getByText('Amaka B.')).toBeTruthy();
    const terms = screen.getByLabelText('Commercial terms');
    expect(within(terms).getByText('Price')).toBeTruthy();
    expect(within(terms).getByText('Inspection')).toBeTruthy();
    expect(within(terms).getByText(/48 hours/)).toBeTruthy();
    expect(screen.getByText(/Accepted terms are locked/)).toBeTruthy();
  });

  it('is the same for the seller, and links back to the trade and to the history', async () => {
    serve(workspaceTrade('FUNDED', 'SELLER'));
    renderWithApi(api.call, <AgreementScreen id={id(1)} />);
    await screen.findByText(/authoritative agreement/);
    expect(screen.getByRole('link', { name: 'Back to trade' }).getAttribute('href')).toBe(`/trade/${id(1)}`);
    expect(screen.getByRole('link', { name: 'Version history' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/agreement/history`,
    );
  });

  it('says there is no agreement yet for a proposal that has not been accepted', async () => {
    serve(workspaceTrade('AWAITING_ACCEPTANCE', 'BUYER', { acceptedAt: null }));
    renderWithApi(api.call, <AgreementScreen id={id(1)} />);
    expect(await screen.findByText('Nothing has been agreed yet')).toBeTruthy();
  });

  it('has no serious accessibility violations', async () => {
    serve(workspaceTrade('PENDING_PAYMENT', 'BUYER'));
    const { container } = renderWithApi(api.call, <AgreementScreen id={id(1)} />);
    await screen.findByText(/authoritative agreement/);
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

describe('CWT-S02 Agreement History', () => {
  it('lists every version, the accepted one last, with the acceptance and trade rows', async () => {
    serve(workspaceTrade('PENDING_PAYMENT', 'BUYER'));
    renderWithApi(api.call, <AgreementHistory id={id(1)} />);
    expect(await screen.findByText('Version 2 · Accepted')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Agreement History' })).toBeTruthy();
    const steps = screen.getByRole('list', { name: 'Versions of this agreement' });
    expect(within(steps).getByText('Version 1 · Buyer proposal')).toBeTruthy();
    expect(within(steps).getByText('Version 2 · Accepted')).toBeTruthy();
    expect(within(steps).getByText(/Seller counter, accepted by buyer and seller/)).toBeTruthy();
    expect(within(steps).getAllByText(/29 Sep/)).toHaveLength(2);
    expect(screen.getByText('KMT-9042800-NG')).toBeTruthy();
    expect(
      screen.getByText('Earlier proposals remain visible without replacing the accepted version.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View accepted terms' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/agreement`,
    );
    expect(screen.getByRole('link', { name: 'Return to trade' }).getAttribute('href')).toBe(
      `/trade/${id(1)}`,
    );
  });

  it('falls back to superseded versions, with the accepted amount, when the activity cannot account for them', async () => {
    serve(workspaceTrade('PENDING_PAYMENT', 'BUYER'), page([]));
    renderWithApi(api.call, <AgreementHistory id={id(1)} />);
    const steps = await screen.findByRole('list', { name: 'Versions of this agreement' });
    expect(within(steps).getByText('Version 1')).toBeTruthy();
    expect(within(steps).getByText('Superseded')).toBeTruthy();
    expect(within(steps).getByText(/accepted by buyer and seller/)).toBeTruthy();
  });

  it('has no serious accessibility violations', async () => {
    serve(workspaceTrade('PENDING_PAYMENT', 'BUYER'));
    const { container } = renderWithApi(api.call, <AgreementHistory id={id(1)} />);
    await screen.findByText('Version 2 · Accepted');
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

describe('the states every one-trade screen shares', () => {
  it('shows loading while the trade is read', () => {
    api.call.mockImplementation(() => new Promise(() => undefined));
    renderWithApi(api.call, <AgreementScreen id={id(1)} />);
    expect(screen.getByRole('status', { name: 'Loading the agreement' })).toBeTruthy();
  });

  it('offers a retry after a failed read', async () => {
    answerWith(api.call, { 'GET /trades/:id': problem('INTERNAL', 500) });
    renderWithApi(api.call, <AgreementScreen id={id(1)} />);
    expect(await screen.findByText("Couldn't open this trade")).toBeTruthy();
    serve(workspaceTrade('PENDING_PAYMENT', 'BUYER'));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/authoritative agreement/)).toBeTruthy();
  });

  it('says so when the device is offline and the trade has not been read', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    answerWith(api.call, { 'GET /trades/:id': new Error('network') });
    renderWithApi(api.call, <AgreementScreen id={id(1)} />);
    expect(await screen.findByText("You're offline")).toBeTruthy();
    online.mockRestore();
  });

  it("says it can't find the trade, whoever it belongs to, with no retry: the platform answers a non-party with the same 404", async () => {
    answerWith(api.call, { 'GET /trades/:id': problem('NOT_FOUND', 404) });
    renderWithApi(api.call, <AgreementScreen id={id(1)} />);
    expect(await screen.findByText("We can't find this trade")).toBeTruthy();
    expect(screen.getByText(/belongs to another account/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('keeps the header and the way back on every failure, never a dead end', async () => {
    answerWith(api.call, { 'GET /trades/:id': problem('NOT_FOUND', 404) });
    renderWithApi(api.call, <TradePolicies id={id(1)} />);
    await screen.findByText("We can't find this trade");
    expect(screen.getByRole('heading', { level: 1, name: 'Trade Policies' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to the trade' }).getAttribute('href')).toBe(
      `/trade/${id(1)}`,
    );
  });
});
