// @vitest-environment jsdom
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SELLER_TO_CONFIRM } from '../src/trade/create/request';
import { TradeScreen } from '../src/trade/TradeScreen';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  address,
  answerWith,
  callsTo,
  counterparty,
  id,
  page,
  preview,
  renderWithApi,
  standardsPage,
  tradeView,
  type CallFn,
} from './support/trade';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

const problem = (code: string, status = 409) =>
  new ProblemError(
    { type: 'about:blank', title: 'Reworded title', status, code },
    { status, requestId: undefined, replayed: false, retryAfterMs: undefined, rateLimit: undefined },
    false,
  );

const baseTerms = tradeView().terms as NonNullable<ReturnType<typeof tradeView>['terms']>;
const offer = {
  requestedItem: 'iPhone 13 Pro, 256GB',
  brand: 'Apple',
  model: 'iPhone 13 Pro',
  condition: 'Brand new',
  deliveryMode: 'COURIER',
  deliveryPartner: 'SwiftDrop',
  deliveryChargeMinor: '350000',
  deliveryPromise: '5-7',
};

/** A seller's finished offer, as the buyer whose turn it is sees it. */
const asBuyer = (spec: Record<string, unknown> = offer, over: Record<string, unknown> = {}) =>
  tradeView({
    yourRole: 'BUYER',
    initiatorRole: 'SELLER',
    awaiting: 'YOU',
    counterparty: counterparty({ displayName: 'TechEdge NG', username: 'techedge' }),
    terms: {
      ...baseTerms,
      proposedByRole: 'SELLER',
      itemSpec: spec,
      deliveryAddress: null,
      shipsFromAddress: { street: '12 Computer Village Rd', landmark: 'Ikeja' },
    },
    ...over,
  });

const handlers = (view: unknown, more: Record<string, unknown> = {}) => ({
  'GET /trades/:id': view,
  'GET /me/addresses': page([address(1)]),
  'GET /config/trade-standards': standardsPage(),
  'POST /trades/preview': preview(),
  'GET /trades': page([]),
  'POST /trades/:id/accept': tradeView({ status: 'PENDING_PAYMENT', awaiting: null }),
  'POST /trades/:id/decline': tradeView({ status: 'DECLINED', awaiting: null }),
  ...more,
});

beforeEach(() => {
  api.call.mockReset();
  router.push.mockReset();
});
afterEach(cleanup);

const press = (name: string | RegExp) => {
  fireEvent.click(screen.getByRole('button', { name }));
};

async function toS7() {
  await screen.findByText('Item details confirmed by the seller');
  await waitFor(() => {
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Home/ }).checked).toBe(true);
  });
  press('Review agreement');
  await screen.findByRole('button', { name: 'Accept & continue to payment' });
}

describe('CT-S6 Choose how to receive it', () => {
  it('locks the specification, shows the seller cost and offers Courier with the delivery address', async () => {
    answerWith(api.call, handlers(asBuyer()));
    const view = renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByText('Trade from TechEdge NG')).toBeTruthy();
    expect(screen.getByText('Item details confirmed by the seller')).toBeTruthy();
    expect(screen.getByText(/You can't edit these/)).toBeTruthy();
    expect(screen.getByText('Apple iPhone 13 Pro')).toBeTruthy();
    expect(
      screen.getByText('How would you like to receive it?', { selector: 'h2, div, p, span' }),
    ).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Courier · ₦3,500.00/ }).checked).toBe(true);
    expect(screen.getByText(/SwiftDrop · estimated 5–7 days/)).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Park/ }).disabled).toBe(true);
    expect(screen.getByText(/Coming soon/)).toBeTruthy();
    expect(await screen.findByText('₦458,780.00')).toBeTruthy();
    expect(screen.getByText('Delivery (paid to the seller)')).toBeTruthy();
    expect(screen.getByText(/not part of this total/)).toBeTruthy();
    await expectNoAxeViolations(view.container, SHELL_RULES);
  });

  it('is not the old answer screen, and a seller proposal without commitments still is', async () => {
    answerWith(api.call, handlers(asBuyer({ brand: 'Apple', model: 'iPhone', condition: 'Sealed' })));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByText('Accept terms')).toBeTruthy();
    expect(screen.queryByText('Review agreement')).toBeNull();
  });

  it('will not accept anything the seller has not said', async () => {
    answerWith(api.call, handlers(asBuyer({ ...offer, brand: SELLER_TO_CONFIRM })));
    const view = renderWithApi(api.call, <TradeScreen id={id(1)} />);
    // A spec still waiting is not a seller offer, so the older screen draws it and the sentinel is never shown.
    await screen.findByText('Accept terms');
    expect(view.container.textContent).not.toContain(SELLER_TO_CONFIRM);
  });

  it('waits for an address before it goes on', async () => {
    answerWith(api.call, handlers(asBuyer(), { 'GET /me/addresses': page([]) }));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await screen.findByText('Item details confirmed by the seller');
    press('Review agreement');
    expect(await screen.findByText('Choose an address to carry on.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept & continue to payment' })).toBeNull();
  });
});

describe('CT-S6 and CT-S7 edges', () => {
  it('will not go on or accept until what the buyer pays is known, and offers a retry', async () => {
    let fail = true;
    answerWith(
      api.call,
      handlers(asBuyer(), {
        'POST /trades/preview': () => {
          if (fail) throw problem('INTERNAL', 500);
          return preview();
        },
      }),
    );
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByText(/We couldn't work out what you pay/)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('radio', { name: /Home/ }).checked).toBe(true);
    });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Review agreement' }).disabled).toBe(true);
    fail = false;
    press('Try again');
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Review agreement' }).disabled).toBe(
        false,
      );
    });
    expect(await screen.findByText('₦458,780.00')).toBeTruthy();
    press('Review agreement');
    await screen.findByRole('button', { name: 'Accept & continue to payment' });
  });

  it('moves focus to the new stage heading when the stage changes', async () => {
    answerWith(api.call, handlers(asBuyer()));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await toS7();
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe('Review and accept');
    });
    press('Change delivery');
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe('Choose how to receive it');
    });
  });

  it('holds the decline back until the reason is at least three characters', async () => {
    answerWith(api.call, handlers(asBuyer()));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await toS7();
    press('Decline');
    const confirm = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Decline terms' });
    expect(confirm().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'no' } });
    expect(confirm().disabled).toBe(true);
    fireEvent.click(confirm());
    expect(callsTo(api.call, 'POST', '/trades/:id/decline')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Too dear' } });
    expect(confirm().disabled).toBe(false);
  });
});

describe('CT-S7 Review and accept', () => {
  it('shows the whole agreement the seller made, with the buyer address chosen', async () => {
    answerWith(api.call, handlers(asBuyer()));
    const view = renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await toS7();
    expect(screen.getByRole('heading', { name: 'Terms' })).toBeTruthy();
    expect(screen.getByText('TechEdge NG', { selector: 'dd, div, span' })).toBeTruthy();
    expect(screen.getByText('12 Computer Village Rd, Ikeja')).toBeTruthy();
    expect(screen.getByText(/Courier · 12 Allen Avenue, Ikeja/)).toBeTruthy();
    expect(screen.getByText('5–7 days')).toBeTruthy();
    expect(screen.getByText(/Accepting locks this version as the agreement/)).toBeTruthy();
    expect(screen.queryByText('Waiting')).toBeNull();
    await expectNoAxeViolations(view.container, SHELL_RULES);
  });

  it('accepts the version on screen with the address, once, and goes on to pay', async () => {
    answerWith(api.call, handlers(asBuyer()));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await toS7();
    const button = screen.getByRole('button', { name: 'Accept & continue to payment' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/trade/${id(1)}/fund`);
    });
    const calls = callsTo(api.call, 'POST', '/trades/:id/accept');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ termsVersionId: id(40), addressId: id(1) });
  });

  it('goes back to change the delivery', async () => {
    answerWith(api.call, handlers(asBuyer()));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await toS7();
    press('Change delivery');
    expect(
      await screen.findByText('How would you like to receive it?', { selector: 'h2, div, p, span' }),
    ).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/:id/accept')).toHaveLength(0);
  });

  it('says why a stale version was refused and reloads the trade', async () => {
    answerWith(api.call, handlers(asBuyer(), { 'POST /trades/:id/accept': problem('CONFLICT') }));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await toS7();
    const before = callsTo(api.call, 'GET', '/trades/:id').length;
    press('Accept & continue to payment');
    expect(await screen.findByText(/The terms changed while you were looking/)).toBeTruthy();
    await waitFor(() => {
      expect(callsTo(api.call, 'GET', '/trades/:id').length).toBeGreaterThan(before);
    });
    expect(router.push).not.toHaveBeenCalled();
  });

  it('declines with a reason through the confirmation', async () => {
    answerWith(api.call, handlers(asBuyer()));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await toS7();
    press('Decline');
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Changed my mind' } });
    press('Decline terms');
    await waitFor(() => {
      expect(callsTo(api.call, 'POST', '/trades/:id/decline')[0]?.body).toEqual({
        reason: 'Changed my mind',
      });
    });
  });

  it('links to propose a change', async () => {
    answerWith(api.call, handlers(asBuyer()));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await toS7();
    expect(screen.getByRole('link', { name: 'Propose a change' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/counter`,
    );
  });
});
