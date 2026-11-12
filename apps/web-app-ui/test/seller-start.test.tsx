// @vitest-environment jsdom
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SellerStart } from '../src/trade/create/SellerStart';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  address,
  answerWith,
  callsTo,
  id,
  miss,
  page,
  party,
  preview,
  renderWithApi,
  standardsPage,
  tradeView,
  type CallFn,
} from './support/trade';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

const problem = (code: string, status = 422) =>
  new ProblemError(
    { type: 'about:blank', title: 'Reworded title', status, code },
    { status, requestId: undefined, replayed: false, retryAfterMs: undefined, rateLimit: undefined },
    false,
  );

const drafted = tradeView({
  id: id(1),
  status: 'DRAFT',
  awaiting: null,
  yourRole: 'SELLER',
  initiatorRole: 'SELLER',
});
const sentView = tradeView({
  id: id(1),
  status: 'AWAITING_ACCEPTANCE',
  awaiting: 'COUNTERPARTY',
  yourRole: 'SELLER',
  initiatorRole: 'SELLER',
});

let uploads = 0;
const handlers = (over: Record<string, unknown> = {}) => ({
  'GET /config/trade-standards': standardsPage(),
  'POST /trades/preview': preview(),
  'GET /me/addresses': page([address(1)]),
  'GET /parties/lookup': party({ displayName: 'Amaka O.', username: 'amaka' }),
  'POST /parties/lookup': miss(),
  'POST /trades': drafted,
  'POST /trades/:id/send': sentView,
  'POST /trades/:id/cancel': drafted,
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
  ...over,
});

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

async function aboutStage(who = '@amaka', title = 'iPhone 13 Pro 256GB') {
  await screen.findByLabelText(/Who's the buyer/);
  type(/Who's the buyer/, who);
  type('Item', title);
  type('Agreed price', '452,000');
}

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
    expect(callsTo(api.call, 'POST', '/files/:id/finalize')).toHaveLength(2);
  });
  await waitFor(() => {
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Home/ }).checked).toBe(true);
  });
}

async function toTerms(container: HTMLElement) {
  await aboutStage();
  press('Continue');
  await itemStage(container);
  press('Continue');
  await screen.findByText('Trade terms');
}

async function toReview(container: HTMLElement) {
  await toTerms(container);
  type('Delivery partner', 'SwiftDrop');
  type('Delivery charge (₦)', '3,500');
  fireEvent.click(screen.getByRole('radio', { name: '5–7 days' }));
  press('Review');
  await screen.findByRole('button', { name: 'Send to buyer' });
}

describe('CT-S1 About', () => {
  it('asks who the buyer is, what is sold and for how much, and detects the category', async () => {
    answerWith(api.call, handlers());
    const view = renderWithApi(api.call, <SellerStart />);
    await aboutStage();
    expect(await screen.findByText(/We detected the category: Electronics/)).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Create Trade, step 1 of 4' })).toBeTruthy();
    expect(await screen.findByText('You receive ₦452,000.00 when the trade completes.')).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/preview').at(-1)?.body).toEqual({
      role: 'SELLER',
      categoryCode: 'electronics',
      itemAmountMinor: '45200000',
    });
    await expectNoAxeViolations(view.container, SHELL_RULES);
  });

  it('asks for the category only when nothing could be detected', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <SellerStart />);
    await aboutStage('@amaka', 'Antique chair');
    expect(screen.getByLabelText('Category')).toBeTruthy();
    press('Continue');
    expect(await screen.findByText('Choose a category to carry on')).toBeTruthy();
  });

  it('names what is missing and goes nowhere', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <SellerStart />);
    await screen.findByLabelText(/Who's the buyer/);
    press('Continue');
    expect(await screen.findByText('Enter their @username, email address or phone number')).toBeTruthy();
    expect(screen.getByText('Say what you are selling')).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades')).toHaveLength(0);
  });

  it('blocks a certified merchant as the buyer', async () => {
    answerWith(api.call, handlers({ 'GET /parties/lookup': party({ canBuy: false, isMerchant: true }) }));
    renderWithApi(api.call, <SellerStart />);
    await aboutStage('@bigshop');
    fireEvent.blur(screen.getByLabelText(/Who's the buyer/));
    expect(await screen.findByText("They can't be the buyer")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Continue' }).disabled).toBe(true);
  });

  it('invites someone who is not on Komtru and says how', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <SellerStart />);
    await aboutStage('0802 341 5567');
    fireEvent.blur(screen.getByLabelText(/Who's the buyer/));
    expect(await screen.findByText(/They're invited to join/)).toBeTruthy();
  });

  it('refuses a username it cannot find', async () => {
    answerWith(api.call, handlers({ 'GET /parties/lookup': miss(false) }));
    renderWithApi(api.call, <SellerStart />);
    await aboutStage('@nobody');
    fireEvent.blur(screen.getByLabelText(/Who's the buyer/));
    expect(await screen.findByText("We can't find that username")).toBeTruthy();
  });

  it('shows a loading state and a failure with a retry', async () => {
    answerWith(api.call, handlers({ 'GET /config/trade-standards': problem('INTERNAL', 500) }));
    renderWithApi(api.call, <SellerStart />);
    expect(screen.getByRole('status', { name: 'Loading the categories' })).toBeTruthy();
    expect(await screen.findByText("Couldn't load the categories")).toBeTruthy();
  });

  it('says so when there are no categories', async () => {
    answerWith(api.call, handlers({ 'GET /config/trade-standards': standardsPage([]) }));
    renderWithApi(api.call, <SellerStart />);
    expect(await screen.findByText(/no trade categories/)).toBeTruthy();
  });

  it('names the buyer in advance from a link', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <SellerStart counterparty="@amaka" />);
    expect((await screen.findByLabelText<HTMLInputElement>(/Who's the buyer/)).value).toBe('@amaka');
  });
});

describe('CT-S2 and CT-S2F Item and delivery', () => {
  it('asks for the category fields, the photos and where it ships from, and not where it goes', async () => {
    answerWith(api.call, handlers());
    const view = renderWithApi(api.call, <SellerStart />);
    await aboutStage();
    press('Continue');
    await screen.findByLabelText('Brand');
    expect(screen.getByLabelText('Model')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Used · like new' })).toBeTruthy();
    expect(screen.getByText('Photos of the item')).toBeTruthy();
    expect(screen.getByText('Ships from')).toBeTruthy();
    expect(screen.getByText(/The buyer gives their delivery address after you send this/)).toBeTruthy();
    press('Continue');
    expect(await screen.findByText('Add the brand to carry on.')).toBeTruthy();
    expect(screen.getByText('Choose the condition to carry on.')).toBeTruthy();
    await expectNoAxeViolations(view.container, SHELL_RULES);
  });

  it('holds the seller at the item until the photos are attached', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <SellerStart />);
    await aboutStage();
    press('Continue');
    await screen.findByLabelText('Brand');
    type('Brand', 'Apple');
    type('Model', 'iPhone 13 Pro');
    fireEvent.click(screen.getByRole('radio', { name: 'Brand new' }));
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('radio', { name: /Home/ }).checked).toBe(true);
    });
    press('Continue');
    expect(await screen.findByText('Add the photos and video to carry on.')).toBeTruthy();
  });

  it('loads the Fashion & Luxury specification instead of the Electronics form', async () => {
    answerWith(api.call, handlers());
    const view = renderWithApi(api.call, <SellerStart />);
    await aboutStage();
    press('Continue');
    await screen.findByLabelText('Model');
    fireEvent.click(screen.getByRole('button', { name: 'This is a Fashion & Luxury item' }));
    expect(await screen.findByText(/Category: Fashion & Luxury/)).toBeTruthy();
    expect(screen.getByLabelText('Brand')).toBeTruthy();
    expect(screen.queryByLabelText('Model')).toBeNull();
    expect(screen.queryByRole('button', { name: /This is a Fashion/ })).toBeNull();
    await expectNoAxeViolations(view.container, SHELL_RULES);
  });

  it('sends no field of the old category when the title flips the category after going back', async () => {
    answerWith(api.call, handlers());
    const view = renderWithApi(api.call, <SellerStart />);
    await aboutStage();
    press('Continue');
    await itemStage(view.container);
    press(/^back$/i);
    await screen.findByLabelText(/Who's the buyer/);
    type('Item', 'Nike sneakers');
    expect(await screen.findByText(/We detected the category: Fashion & Luxury/)).toBeTruthy();
    press('Continue');
    await screen.findByLabelText('Brand');
    expect(screen.queryByLabelText('Model')).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('radio', { name: /Home/ }).checked).toBe(true);
    });
    press('Continue');
    await screen.findByText('Trade terms');
    type('Delivery partner', 'SwiftDrop');
    type('Delivery charge (₦)', '3,500');
    fireEvent.click(screen.getByRole('radio', { name: '5–7 days' }));
    press('Review');
    await screen.findByRole('button', { name: 'Send to buyer' });
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send to buyer' }).disabled).toBe(false);
    });
    press('Send to buyer');
    await screen.findByText('Sent to Amaka O.');
    const created = callsTo(api.call, 'POST', '/trades')[0]?.body as {
      itemSpec: Record<string, unknown>;
      categoryCode: string;
    };
    expect(created.categoryCode).toBe('fashion');
    expect(created.itemSpec.brand).toBe('Apple');
    expect(created.itemSpec).not.toHaveProperty('model');
    expect(created.itemSpec).not.toHaveProperty('condition');
    expect(view.container).toBeTruthy();
  });

  it('forgets nothing the seller attached, and sends nothing hidden, when they go back and return', async () => {
    answerWith(api.call, handlers());
    const view = renderWithApi(api.call, <SellerStart />);
    await toTerms(view.container);
    press(/^back$/i);
    await screen.findByLabelText('Brand');
    // Both photos are still shown, so the gate and what is sent agree.
    expect(screen.getByRole('button', { name: 'Remove front.jpg' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove back.jpg' })).toBeTruthy();
    expect(screen.queryByText('Proof of the item needed')).toBeNull();
    press('Continue');
    await screen.findByText('Trade terms');
    type('Delivery partner', 'SwiftDrop');
    type('Delivery charge (₦)', '3,500');
    fireEvent.click(screen.getByRole('radio', { name: '5–7 days' }));
    press('Review');
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send to buyer' }).disabled).toBe(false);
    });
    press('Send to buyer');
    await screen.findByText('Sent to Amaka O.');
    expect(
      (callsTo(api.call, 'POST', '/trades')[0]?.body as { proofFileIds: string[] }).proofFileIds,
    ).toHaveLength(2);
  });

  it('says the delivery partner is needed when it is left blank', async () => {
    answerWith(api.call, handlers());
    const view = renderWithApi(api.call, <SellerStart />);
    await toTerms(view.container);
    press('Review');
    expect(await screen.findByText('Say which courier you will use')).toBeTruthy();
  });

  it('goes back to the first stage', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <SellerStart />);
    await aboutStage();
    press('Continue');
    await screen.findByLabelText('Brand');
    press(/^back$/i);
    expect(await screen.findByLabelText(/Who's the buyer/)).toBeTruthy();
  });
});

describe('CT-S3 Trade terms', () => {
  it('has the seller set partner, charge and promise, and shows protection as Komtru is', async () => {
    answerWith(api.call, handlers());
    const view = renderWithApi(api.call, <SellerStart />);
    await toTerms(view.container);
    expect(screen.getByText('Set by Komtru — the same for every Trade')).toBeTruthy();
    expect(screen.getByText('Free before shipment')).toBeTruthy();
    // Electronics allows deliveries within 7 days.
    expect(screen.getByRole('radio', { name: '1–3 days' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '5–7 days' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: '10–15 days' })).toBeNull();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Park delivery/ }).disabled).toBe(true);
    expect(screen.getByText(/Coming soon/)).toBeTruthy();
    press('Review');
    expect(await screen.findByText('Choose when you will deliver.')).toBeTruthy();
    await expectNoAxeViolations(view.container, SHELL_RULES);
  });

  it('refuses a charge that is not an amount, and takes zero', async () => {
    answerWith(api.call, handlers());
    const view = renderWithApi(api.call, <SellerStart />);
    await toTerms(view.container);
    type('Delivery partner', 'SwiftDrop');
    type('Delivery charge (₦)', 'abc');
    fireEvent.click(screen.getByRole('radio', { name: '5–7 days' }));
    press('Review');
    expect(await screen.findByText(/Enter the delivery charge in naira/)).toBeTruthy();
    type('Delivery charge (₦)', '0');
    press('Review');
    expect(await screen.findByRole('button', { name: 'Send to buyer' })).toBeTruthy();
  });
});

describe('CT-S4 Review and CT-S5 Sent', () => {
  it('shows the live preview with the buyer waiting on their delivery choice', async () => {
    answerWith(api.call, handlers());
    const view = renderWithApi(api.call, <SellerStart />);
    await toReview(view.container);
    expect(screen.getByRole('list', { name: 'Review, step 4 of 4' })).toBeTruthy();
    expect(screen.getByText('Amaka O.')).toBeTruthy();
    expect(screen.getByText('Buyer')).toBeTruthy();
    expect(screen.getByText(/the buyer gives the address/)).toBeTruthy();
    expect(screen.getByText('₦3,500.00')).toBeTruthy();
    expect(screen.getByText('5–7 days')).toBeTruthy();
    expect(screen.getByText('₦458,780.00')).toBeTruthy();
    expect(screen.getByText('You receive when the trade completes')).toBeTruthy();
    expect(screen.getByText(/not part of this total/)).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades')).toHaveLength(0);
    await expectNoAxeViolations(view.container, SHELL_RULES);
  });

  it('creates the proposal as the seller with everything complete and the commitments, then sends it with the proof', async () => {
    answerWith(api.call, handlers());
    const view = renderWithApi(api.call, <SellerStart />);
    await toReview(view.container);
    press('Send to buyer');
    expect(await screen.findByText('Sent to Amaka O.')).toBeTruthy();
    const created = callsTo(api.call, 'POST', '/trades')[0]?.body as Record<string, unknown>;
    expect(created).toMatchObject({
      role: 'SELLER',
      categoryCode: 'electronics',
      itemAmountMinor: '45200000',
      addressId: id(1),
      itemSpec: {
        requestedItem: 'iPhone 13 Pro 256GB',
        brand: 'Apple',
        model: 'iPhone 13 Pro',
        condition: 'Brand new',
        deliveryMode: 'COURIER',
        deliveryPartner: 'SwiftDrop',
        deliveryChargeMinor: '350000',
        deliveryPromise: '5-7',
      },
    });
    expect(JSON.stringify(created)).not.toContain('Seller to confirm');
    expect(created.proofFileIds).toHaveLength(2);
    const sendBody = callsTo(api.call, 'POST', '/trades/:id/send')[0]?.body as Record<string, unknown>;
    expect(sendBody.username).toBe('amaka');
    expect(sendBody.proofFileIds).toHaveLength(2);
    expect(screen.getByText(/They'll choose how to receive it, give their delivery address/)).toBeTruthy();
    expect(screen.queryByText(/Park/)).toBeNull();
    expect(screen.getByText('KMT-9042800-NG')).toBeTruthy();
    expect(screen.getByText('Amaka O. chooses how to receive it')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to your trades' }).getAttribute('href')).toBe('/trades');
    await expectNoAxeViolations(view.container, SHELL_RULES);
  });

  it('will not send until the fees are known, and offers a retry when they fail to load', async () => {
    let fail = true;
    answerWith(
      api.call,
      handlers({
        'POST /trades/preview': () => {
          if (fail) throw problem('INTERNAL', 500);
          return preview();
        },
      }),
    );
    const view = renderWithApi(api.call, <SellerStart />);
    await toReview(view.container);
    expect(await screen.findByText(/We couldn't work out the fees/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send to buyer' }).disabled).toBe(true);
    fail = false;
    press('Try again');
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send to buyer' }).disabled).toBe(false);
    });
    expect(callsTo(api.call, 'POST', '/trades')).toHaveLength(0);
  });

  it('makes one draft however many times the button is pressed', async () => {
    answerWith(api.call, handlers());
    const view = renderWithApi(api.call, <SellerStart />);
    await toReview(view.container);
    const button = screen.getByRole('button', { name: 'Send to buyer' });
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByText('Sent to Amaka O.');
    expect(callsTo(api.call, 'POST', '/trades')).toHaveLength(1);
    expect(callsTo(api.call, 'POST', '/trades/:id/send')).toHaveLength(1);
  });

  it('retries a failed send on the same draft', async () => {
    let fail = true;
    answerWith(
      api.call,
      handlers({
        'POST /trades/:id/send': () => {
          if (fail) return problem('INTERNAL', 500);
          return sentView;
        },
      }),
    );
    const view = renderWithApi(api.call, <SellerStart />);
    await toReview(view.container);
    press('Send to buyer');
    expect(await screen.findByText(/We couldn't send that/)).toBeTruthy();
    fail = false;
    press('Send to buyer');
    await screen.findByText('Sent to Amaka O.');
    expect(callsTo(api.call, 'POST', '/trades')).toHaveLength(1);
    expect(callsTo(api.call, 'POST', '/trades/:id/send')).toHaveLength(2);
  });

  it('withdraws the draft and makes a new one when the terms were edited after a failed send', async () => {
    let fail = true;
    answerWith(
      api.call,
      handlers({
        'POST /trades/:id/send': () => {
          if (fail) return problem('INTERNAL', 500);
          return sentView;
        },
      }),
    );
    const view = renderWithApi(api.call, <SellerStart />);
    await toReview(view.container);
    press('Send to buyer');
    await screen.findByText(/We couldn't send that/);
    press('Edit');
    type('Delivery charge (₦)', '4,000');
    press('Review');
    fail = false;
    press('Send to buyer');
    await screen.findByText('Sent to Amaka O.');
    expect(callsTo(api.call, 'POST', '/trades')).toHaveLength(2);
    expect(callsTo(api.call, 'POST', '/trades/:id/cancel')).toHaveLength(1);
    const last = callsTo(api.call, 'POST', '/trades').at(-1)?.body as { itemSpec: Record<string, unknown> };
    expect(last.itemSpec.deliveryChargeMinor).toBe('400000');
  });

  it('says why when the platform refuses', async () => {
    answerWith(api.call, handlers({ 'POST /trades': problem('MERCHANT_CANNOT_BUY') }));
    const view = renderWithApi(api.call, <SellerStart />);
    await toReview(view.container);
    press('Send to buyer');
    expect(await screen.findByText(/certified merchant can't be the buyer/)).toBeTruthy();
  });
});
