// @vitest-environment jsdom
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompleteRequest } from '../src/trade/create/CompleteRequest';
import { SELLER_TO_CONFIRM } from '../src/trade/create/request';
import { TradeScreen } from '../src/trade/TradeScreen';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  address,
  answerWith,
  callsTo,
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

const problem = (code: string, status: number, detail?: string) =>
  new ProblemError(
    {
      type: 'about:blank',
      title: 'Reworded title',
      status,
      code,
      ...(detail === undefined ? {} : { detail }),
    },
    { status, requestId: undefined, replayed: false, retryAfterMs: undefined, rateLimit: undefined },
    false,
  );

const baseTerms = tradeView().terms as NonNullable<ReturnType<typeof tradeView>['terms']>;
const openSpec = {
  requestedItem: 'iPhone 13 Pro 256GB',
  brand: SELLER_TO_CONFIRM,
  model: SELLER_TO_CONFIRM,
  condition: SELLER_TO_CONFIRM,
  deliveryMode: 'COURIER',
};
const doneSpec = {
  brand: 'Apple',
  model: 'iPhone 13 Pro',
  condition: 'Brand new',
  deliveryMode: 'COURIER',
  deliveryPartner: 'SwiftDrop',
  deliveryChargeMinor: '250000',
  deliveryPromise: '5-7',
};

/** The buyer's request, as the seller whose turn it is sees it. */
const asSeller = (spec: Record<string, unknown> = openSpec, over: Record<string, unknown> = {}) =>
  tradeView({
    yourRole: 'SELLER',
    initiatorRole: 'BUYER',
    awaiting: 'YOU',
    terms: { ...baseTerms, itemSpec: spec },
    ...over,
  });

/** The seller's finished answer, as the buyer whose turn it is sees it. */
const asBuyer = (spec: Record<string, unknown> = doneSpec, over: Record<string, unknown> = {}) =>
  tradeView({
    yourRole: 'BUYER',
    initiatorRole: 'BUYER',
    awaiting: 'YOU',
    terms: {
      ...baseTerms,
      versionNumber: 2,
      proposedByRole: 'SELLER',
      itemSpec: spec,
      shipsFromAddress: { street: '12 Computer Village Rd', landmark: 'Ikeja' },
    },
    ...over,
  });

let uploads = 0;
const handlers = (view: unknown, more: Record<string, unknown> = {}) => ({
  'GET /trades/:id': view,
  'GET /me/addresses': page([address(1)]),
  'GET /config/trade-standards': standardsPage(),
  'GET /config/trade-standards/versions/:id': ({ params }: { params?: Record<string, string> }) =>
    standardsPage().items.find((item) => item.versionId === params?.id),
  'POST /trades/preview': preview(),
  'GET /trades': page([]),
  ...more,
});

const upload = {
  'POST /files/upload-url': () => {
    uploads += 1;
    return {
      fileId: id(89 + uploads),
      cloudName: 'komtru',
      uploadUrl: 'https://upload.test/x',
      params: { signature: 's' },
      maxBytes: 5_000_000,
      expiresAt: '2026-11-09T12:00:00.000Z',
    };
  },
  'POST /files/:id/finalize': ({ params }: { params?: Record<string, string> }) => ({
    fileId: params?.id,
    uploadState: 'PENDING',
  }),
};

beforeEach(() => {
  api.call.mockReset();
  router.push.mockReset();
  uploads = 0;
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const type = (label: string | RegExp, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};
const press = (name: string | RegExp) => {
  fireEvent.click(screen.getByRole('button', { name }));
};

describe('CT-B6 Trade request', () => {
  it('shows what the buyer asked for and what only the seller can provide', async () => {
    answerWith(api.call, handlers(asSeller()));
    const view = renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByText('iPhone 13 Pro 256GB')).toBeTruthy();
    expect(screen.getByText('Buyer: Amaka B.')).toBeTruthy();
    expect(screen.getByText('₦452,000.00')).toBeTruthy();
    expect(screen.getByText('What the buyer asked for')).toBeTruthy();
    expect(screen.getByText(/Courier · 5 Adeola Odeku, Victoria Island/)).toBeTruthy();
    expect(screen.getByText('Electronics')).toBeTruthy();
    expect(screen.getByText('What only you can provide')).toBeTruthy();
    expect(screen.getAllByText('Waiting')).toHaveLength(3);
    expect(screen.getByText(/The buyer can't edit item details/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Complete the details' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/complete`,
    );
    // No Seller to confirm text leaks onto the screen.
    expect(view.container.textContent).not.toContain(SELLER_TO_CONFIRM);
    await expectNoAxeViolations(view.container, SHELL_RULES);
  });

  it('names a Park request by the Park and its collection phone', async () => {
    const spec = {
      ...openSpec,
      deliveryMode: 'PARK',
      parkName: 'Jos Central Park',
      contactPhone: '0803 221 4471',
    };
    answerWith(api.call, handlers(asSeller(spec)));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByText('Park · Jos Central Park')).toBeTruthy();
    expect(screen.getByText('0803 221 4471')).toBeTruthy();
  });

  it('declines with a reason through the confirmation', async () => {
    answerWith(
      api.call,
      handlers(asSeller(), { 'POST /trades/:id/decline': tradeView({ status: 'DECLINED', awaiting: null }) }),
    );
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await screen.findByText('iPhone 13 Pro 256GB');
    press('Decline');
    type('Reason', 'Out of stock');
    press('Decline request');
    await waitFor(() => {
      expect(callsTo(api.call, 'POST', '/trades/:id/decline')[0]?.body).toEqual({ reason: 'Out of stock' });
    });
  });

  it('leaves a seller-started proposal on the existing answer screen', async () => {
    answerWith(api.call, handlers(tradeView({ yourRole: 'BUYER', initiatorRole: 'SELLER' })));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByText('Accept terms')).toBeTruthy();
  });
});

describe('CT-B7 Item details', () => {
  it('asks for the category standard fields and the proof, and says what is missing', async () => {
    answerWith(api.call, handlers(asSeller(), upload));
    renderWithApi(api.call, <CompleteRequest id={id(1)} />);
    expect(await screen.findByText(/Electronics specification/)).toBeTruthy();
    expect(screen.getByLabelText('Brand')).toBeTruthy();
    expect(screen.getByLabelText('Model')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Brand new' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Used · like new' })).toBeTruthy();
    expect(screen.getByText('Photos of the item')).toBeTruthy();
    press('Continue');
    expect(await screen.findByText('Add the brand to carry on.')).toBeTruthy();
    expect(screen.getByText('Choose the condition to carry on.')).toBeTruthy();
    expect(screen.queryByText('Delivery partner')).toBeNull();
  });

  it('holds the seller at the item until the photos are attached', async () => {
    answerWith(api.call, handlers(asSeller(), upload));
    renderWithApi(api.call, <CompleteRequest id={id(1)} />);
    await screen.findByLabelText('Brand');
    type('Brand', 'Apple');
    type('Model', 'iPhone 13 Pro');
    fireEvent.click(screen.getByRole('radio', { name: 'Brand new' }));
    press('Continue');
    expect(await screen.findByText('Add the photos and video to carry on.')).toBeTruthy();
  });

  it("says there is nothing to complete when it is not the seller's request", async () => {
    answerWith(api.call, handlers(asBuyer()));
    renderWithApi(api.call, <CompleteRequest id={id(1)} />);
    expect(await screen.findByText(/nothing for you to complete/)).toBeTruthy();
  });

  it('shows a loading state and a failure with a retry', async () => {
    answerWith(api.call, handlers(problem('INTERNAL', 500)));
    renderWithApi(api.call, <CompleteRequest id={id(1)} />);
    expect(screen.getByRole('status', { name: 'Loading the request' })).toBeTruthy();
    expect(await screen.findByText("Couldn't open this request")).toBeTruthy();
  });
});

/** Fills CT-B7 and moves to the delivery stage. */
async function itemStage(container: HTMLElement) {
  await screen.findByLabelText('Brand');
  type('Brand', 'Apple');
  type('Model', 'iPhone 13 Pro');
  fireEvent.click(screen.getByRole('radio', { name: 'Brand new' }));
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  fireEvent.change(input as HTMLInputElement, {
    target: {
      files: [
        new File(['x'], 'front.jpg', { type: 'image/jpeg' }),
        new File(['x'], 'back.jpg', { type: 'image/jpeg' }),
      ],
    },
  });
  await waitFor(() => {
    expect(uploads).toBe(2);
  });
  await waitFor(() => {
    expect(callsTo(api.call, 'POST', '/files/:id/finalize')).toHaveLength(2);
  });
  press('Continue');
}

describe('CT-B8 Delivery, Courier', () => {
  it('asks for the partner, the charge and a promise the category allows', async () => {
    answerWith(api.call, handlers(asSeller(), upload));
    const view = renderWithApi(api.call, <CompleteRequest id={id(1)} />);
    await itemStage(view.container);
    expect(await screen.findByText(/The buyer asked for courier delivery to 5 Adeola Odeku/)).toBeTruthy();
    expect(screen.getByLabelText('Delivery partner')).toBeTruthy();
    // Electronics allows seven days at most: the two longer ranges are not offered.
    expect(screen.getByRole('radio', { name: '1–3 days' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '5–7 days' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: '7–10 days' })).toBeNull();
    expect(
      screen.getByText(/Ranges shown are the ones Komtru allows for Electronics by courier/),
    ).toBeTruthy();
    press('Review');
    expect(await screen.findByText('Enter the delivery charge in naira, for example 2,500')).toBeTruthy();
    expect(screen.getByText('Choose when you will deliver.')).toBeTruthy();
  });
});

describe('CT-B8P Delivery, Park', () => {
  it("names the Park the buyer chose and asks for the seller's own charge, with no partner", async () => {
    const spec = {
      ...openSpec,
      deliveryMode: 'PARK',
      parkName: 'Jos Central Park',
      contactPhone: '0803 221 4471',
    };
    answerWith(api.call, handlers(asSeller(spec), upload));
    const view = renderWithApi(api.call, <CompleteRequest id={id(1)} />);
    await itemStage(view.container);
    expect(await screen.findByText(/The buyer chose to collect at a Park: Jos Central Park/)).toBeTruthy();
    expect(screen.queryByLabelText('Delivery partner')).toBeNull();
    expect(screen.getByText('You set this. The buyer sees it before accepting.')).toBeTruthy();
    expect(screen.getByText(/by Park/)).toBeTruthy();
  });
});

describe('CT-B9 Confirm & send to the buyer', () => {
  async function toReview(
    spec: Record<string, unknown> = openSpec,
    more: Record<string, unknown> = {},
  ): Promise<{ container: HTMLElement }> {
    answerWith(
      api.call,
      handlers(asSeller(spec), {
        ...upload,
        'POST /trades/:id/counter': asBuyer(doneSpec, { awaiting: 'COUNTERPARTY' }),
        ...more,
      }),
    );
    const view = renderWithApi(api.call, <CompleteRequest id={id(1)} />);
    await itemStage(view.container);
    await screen.findByLabelText('Delivery partner');
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('radio', { name: /Home/ }).checked).toBe(true);
    });
    type('Delivery partner', 'SwiftDrop');
    type(/Delivery charge/, '2,500');
    fireEvent.click(screen.getByRole('radio', { name: '5–7 days' }));
    press('Review');
    await screen.findByRole('button', { name: 'Confirm & send to buyer' });
    return view;
  }

  it("shows the completed trade as the buyer will see it, with the platform's figures", async () => {
    const view = await toReview();
    expect(screen.getByText('Apple iPhone 13 Pro')).toBeTruthy();
    expect(screen.getByText('₦2,500.00')).toBeTruthy();
    expect(screen.getByText('5–7 days')).toBeTruthy();
    expect(screen.getByText('48 hours · Electronics standard')).toBeTruthy();
    expect(screen.getByText('₦458,780.00')).toBeTruthy();
    expect(screen.getByText(/The delivery charge is shown above and is not part of this total/)).toBeTruthy();
    expect(screen.getByText(/Nothing is final until they do and fund the Trade/)).toBeTruthy();
    await expectNoAxeViolations(view.container, SHELL_RULES);
  });

  it('sends it back as one counter against the revision the seller read', async () => {
    await toReview();
    press('Confirm & send to buyer');
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/trade/${id(1)}`);
    });
    expect(callsTo(api.call, 'POST', '/trades/:id/counter')[0]).toEqual({
      params: { id: id(1) },
      body: {
        expectedRevision: 2,
        itemSpec: {
          brand: 'Apple',
          model: 'iPhone 13 Pro',
          condition: 'Brand new',
          deliveryMode: 'COURIER',
          deliveryPartner: 'SwiftDrop',
          deliveryChargeMinor: '250000',
          deliveryPromise: '5-7',
        },
        addressId: id(1),
        proofFileIds: [id(90), id(91)],
      },
    });
  });

  it('goes back with Edit, and says so when the platform refuses', async () => {
    await toReview(openSpec, {
      'POST /trades/:id/counter': problem('CONFLICT', 409, 'The trade moved on'),
    });
    press('Confirm & send to buyer');
    expect(await screen.findByText(/The terms changed while you were looking/)).toBeTruthy();
    press('Edit');
    expect(await screen.findByLabelText('Brand')).toBeTruthy();
  });
});

describe('CT-B10 Review & accept', () => {
  it('shows the finished agreement with the full cost visible', async () => {
    answerWith(api.call, handlers(asBuyer()));
    const view = renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByText('Apple iPhone 13 Pro')).toBeTruthy();
    expect(screen.getByText('Amaka B. confirmed the details')).toBeTruthy();
    expect(screen.getAllByText('Brand new').length).toBeGreaterThan(0);
    expect(screen.getByText('12 Computer Village Rd, Ikeja')).toBeTruthy();
    expect(screen.getByText('₦2,500.00')).toBeTruthy();
    expect(screen.getByText('5–7 days')).toBeTruthy();
    expect(await screen.findByText('₦458,780.00')).toBeTruthy();
    expect(screen.getByText(/Accepting locks this version as the agreement/)).toBeTruthy();
    expect(screen.queryByText('Waiting')).toBeNull();
    await expectNoAxeViolations(view.container, SHELL_RULES);
  });

  it("prefers the trade's own fee snapshot to a preview", async () => {
    const fees = {
      scheduleVersion: '1',
      itemAmountMinor: '45200000',
      buyerProtectionFeeMinor: '700000',
      buyerTotalMinor: '45900000',
      commissionMinor: '0',
      sellerProceedsMinor: '45200000',
    };
    answerWith(api.call, handlers(asBuyer(doneSpec, { fees })));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByText('₦459,000.00')).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/preview')).toHaveLength(0);
  });

  it('accepts the version on screen and goes on to payment', async () => {
    answerWith(
      api.call,
      handlers(asBuyer(), {
        'POST /trades/:id/accept': tradeView({ status: 'PENDING_PAYMENT', awaiting: null }),
      }),
    );
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await screen.findByText('Apple iPhone 13 Pro');
    press('Accept & continue to payment');
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/trade/${id(1)}/fund`);
    });
    expect(callsTo(api.call, 'POST', '/trades/:id/accept')[0]).toEqual({
      params: { id: id(1) },
      body: { termsVersionId: id(40) },
    });
  });

  it('says why when the platform refuses, and reads the latest version after a conflict', async () => {
    answerWith(
      api.call,
      handlers(asBuyer(), { 'POST /trades/:id/accept': problem('CONFLICT', 409, 'The terms changed') }),
    );
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await screen.findByText('Apple iPhone 13 Pro');
    press('Accept & continue to payment');
    expect(await screen.findByText(/The terms changed while you were looking/)).toBeTruthy();
    await waitFor(() => {
      expect(callsTo(api.call, 'GET', '/trades/:id').length).toBeGreaterThan(1);
    });
    expect(router.push).not.toHaveBeenCalled();
  });

  it("will not accept while the seller's details are still open", async () => {
    answerWith(api.call, handlers(asBuyer(openSpec)));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByText('Still waiting on the seller')).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Accept & continue to payment' }).disabled,
    ).toBe(true);
  });

  it('offers a change or a decline instead of an unbuilt message thread', async () => {
    answerWith(
      api.call,
      handlers(asBuyer(), { 'POST /trades/:id/decline': tradeView({ status: 'DECLINED', awaiting: null }) }),
    );
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await screen.findByText('Apple iPhone 13 Pro');
    expect(screen.getByRole('link', { name: 'Propose a change' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/counter`,
    );
    press('Decline');
    type('Reason', 'Too expensive');
    press('Decline terms');
    await waitFor(() => {
      expect(callsTo(api.call, 'POST', '/trades/:id/decline')[0]?.body).toEqual({ reason: 'Too expensive' });
    });
  });
});
