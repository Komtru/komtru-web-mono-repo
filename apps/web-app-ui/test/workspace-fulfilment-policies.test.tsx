// @vitest-environment jsdom
// TW-02 (Fulfilment Terms) and TW-04 (Trade Policies): what was agreed about getting the item there, and the
// rules that apply to every trade, drawn for both people.
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FulfilmentTerms } from '../src/trade/terms/FulfilmentTerms';
import { TradePolicies } from '../src/trade/terms/TradePolicies';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  answerWith,
  electronics,
  id,
  renderWithApi,
  workspaceTrade,
  type CallFn,
} from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const withCourier = (role: 'BUYER' | 'SELLER' = 'BUYER') =>
  workspaceTrade('PENDING_PAYMENT', role, {
    terms: {
      ...workspaceTrade('PENDING_PAYMENT').terms,
      itemSpec: {
        brand: 'Apple',
        model: 'iPhone 13',
        deliveryMode: 'COURIER',
        deliveryChargeMinor: '350000',
      },
      deliveryAddress: { street: '5 Adeola Odeku', landmark: 'Lagos Island' },
    },
  });

const serve = (trade: unknown, standard: unknown = electronics) =>
  answerWith(api.call, {
    'GET /trades/:id': trade,
    'GET /config/trade-standards/versions/:id': standard,
  });

describe('TW-02 fulfilment terms', () => {
  it('shows the agreed category, inspection period, delivery method, destination and charge', async () => {
    serve(withCourier());
    renderWithApi(api.call, <FulfilmentTerms id={id(1)} />);
    const terms = await screen.findByLabelText('Fulfilment terms');
    expect(within(terms).getByText('Electronics')).toBeTruthy();
    expect(within(terms).getByText('48 hours')).toBeTruthy();
    expect(within(terms).getByText('Courier delivery')).toBeTruthy();
    expect(within(terms).getByText('5 Adeola Odeku, Lagos Island')).toBeTruthy();
    expect(within(terms).getByText(/₦3,500/)).toBeTruthy();
  });

  it("names the category's minimum from the standard the trade pinned", async () => {
    serve(withCourier());
    renderWithApi(api.call, <FulfilmentTerms id={id(1)} />);
    expect(await screen.findByText('48 hours — Electronics standard')).toBeTruthy();
    expect(screen.getByText(/never shorter than the minimum/)).toBeTruthy();
  });

  it('still draws the terms when the standard cannot be read', async () => {
    serve(withCourier(), new Error('down'));
    renderWithApi(api.call, <FulfilmentTerms id={id(1)} />);
    expect(await screen.findByLabelText('Fulfilment terms')).toBeTruthy();
    expect(screen.queryByText(/Electronics standard/)).toBeNull();
  });

  it('is read-only for both: terms are locked once accepted, and the way back is the trade', async () => {
    serve(withCourier('SELLER'));
    renderWithApi(api.call, <FulfilmentTerms id={id(1)} />);
    await screen.findByLabelText('Fulfilment terms');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText(/Accepted terms are locked/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to the trade' }).getAttribute('href')).toBe(
      `/trade/${id(1)}`,
    );
  });

  it('says nothing is agreed for a proposal that has not been accepted', async () => {
    serve(workspaceTrade('AWAITING_ACCEPTANCE', 'BUYER', { acceptedAt: null }));
    renderWithApi(api.call, <FulfilmentTerms id={id(1)} />);
    expect(await screen.findByText('Nothing has been agreed yet')).toBeTruthy();
  });

  it('has no serious accessibility violations', async () => {
    serve(withCourier());
    const { container } = renderWithApi(api.call, <FulfilmentTerms id={id(1)} />);
    await screen.findByText('48 hours — Electronics standard');
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

describe('TW-04 trade policies', () => {
  const policies = () => {
    serve(withCourier());
    return renderWithApi(api.call, <TradePolicies id={id(1)} />);
  };

  it('sets out cancellation, inspection windows and full-refund grounds in the reference words', async () => {
    policies();
    expect(
      await screen.findByText(
        'The applicable terms are shown with the trade. Final outcomes depend on state, evidence and policy.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Cancellation may be requested')).toBeTruthy();
    expect(screen.getByText('Use the return / dispute flow')).toBeTruthy();
    expect(screen.getByText('48h minimum')).toBeTruthy();
    expect(screen.getByText('24h minimum')).toBeTruthy();
    expect(screen.getByText('Damaged, not as described, incomplete')).toBeTruthy();
    expect(screen.getByText(/ask for more inspection time with a reason/)).toBeTruthy();
  });

  it('continues to the trade', async () => {
    policies();
    expect((await screen.findByRole('link', { name: 'Continue' })).getAttribute('href')).toBe(
      `/trade/${id(1)}`,
    );
  });

  it('has no serious accessibility violations', async () => {
    const { container } = policies();
    await screen.findByText('48h minimum');
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('shows the trade loading failure rather than the policies when the trade cannot be read', async () => {
    answerWith(api.call, { 'GET /trades/:id': new Error('down') });
    renderWithApi(api.call, <TradePolicies id={id(1)} />);
    expect(await screen.findByText("Couldn't open this trade")).toBeTruthy();
  });
});
