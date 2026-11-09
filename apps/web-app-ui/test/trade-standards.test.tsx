// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TradeStandards } from '../src/trade/TradeStandards';
import { expectNoAxeViolations } from './axe';
import {
  answerWith,
  callsTo,
  electronics,
  fashion,
  renderWithApi,
  standardsPage,
  type CallFn,
} from './support/trade';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

describe('Trade Standards (CTS1)', () => {
  it('draws one card per category from what the platform serves, in its own words', async () => {
    answerWith(api.call, { 'GET /config/trade-standards': standardsPage() });
    const { container } = renderWithApi(api.call, <TradeStandards />);

    const electronicsTerms = await screen.findByLabelText('Electronics terms');
    expect(within(electronicsTerms).getByText('Inspection window').nextElementSibling?.textContent).toBe(
      '48 hours',
    );
    expect(within(electronicsTerms).getByText('Item details').nextElementSibling?.textContent).toBe(
      'Brand, Model, Condition, Serial number',
    );
    expect(within(electronicsTerms).getByText('Seller proof').nextElementSibling?.textContent).toBe(
      '2 photos',
    );
    expect(within(electronicsTerms).getByText('Delivery deadline').nextElementSibling?.textContent).toBe(
      '7 days',
    );

    const fashionTerms = screen.getByLabelText('Fashion & Luxury terms');
    expect(within(fashionTerms).getByText('Inspection window').nextElementSibling?.textContent).toBe(
      '24 hours',
    );
    expect(within(fashionTerms).getByText('Seller proof').nextElementSibling?.textContent).toBe(
      'None required',
    );
    expect(callsTo(api.call, 'GET', '/config/trade-standards')[0]?.query).toMatchObject({ page: 1 });
    await expectNoAxeViolations(container, SHELL_RULES_ONLY);
  });

  it('says a required video as well as photos', async () => {
    answerWith(api.call, {
      'GET /config/trade-standards': standardsPage([
        { ...electronics, proofMedia: { minPhotos: 1, requireVideo: true } },
      ]),
    });
    renderWithApi(api.call, <TradeStandards />);
    const terms = await screen.findByLabelText('Electronics terms');
    expect(within(terms).getByText('Seller proof').nextElementSibling?.textContent).toBe(
      '1 photo and a video',
    );
  });

  it('does not state terms the platform does not carry', async () => {
    answerWith(api.call, { 'GET /config/trade-standards': standardsPage([electronics, fashion]) });
    renderWithApi(api.call, <TradeStandards />);
    await screen.findByLabelText('Electronics terms');
    for (const invented of ['Clock starts', 'Buyer can request', 'Full refund if', 'Cancellation']) {
      expect(screen.queryByText(invented)).toBeNull();
    }
  });

  it('offers a retry when the standards cannot be read, and reads again', async () => {
    let attempts = 0;
    answerWith(api.call, {
      'GET /config/trade-standards': () => {
        attempts += 1;
        return attempts === 1 ? new Error('offline') : standardsPage();
      },
    });
    renderWithApi(api.call, <TradeStandards />);
    expect(await screen.findByText("Couldn't load the Trade Standards")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Electronics terms')).toBeTruthy();
    });
  });
});

const SHELL_RULES_ONLY = ['heading-order'];
