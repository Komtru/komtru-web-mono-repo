// @vitest-environment jsdom
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuyerStart } from '../src/trade/create/BuyerStart';
import { SELLER_TO_CONFIRM } from '../src/trade/create/request';
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

const problem = (code: string, status = 422, detail?: string) =>
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

const drafted = tradeView({ id: id(1), status: 'DRAFT', awaiting: null, yourRole: 'BUYER' });
const sent = tradeView({
  id: id(1),
  status: 'AWAITING_ACCEPTANCE',
  awaiting: 'COUNTERPARTY',
  yourRole: 'BUYER',
});

const handlers = (over: Record<string, unknown> = {}) => ({
  'GET /config/trade-standards': standardsPage(),
  'POST /trades/preview': preview(),
  'GET /me/addresses': page([address(1)]),
  'GET /parties/lookup': party(),
  'POST /parties/lookup': miss(),
  'POST /trades': drafted,
  'POST /trades/:id/send': sent,
  ...over,
});

beforeEach(() => {
  api.call.mockReset();
  router.push.mockReset();
});
afterEach(cleanup);

const type = (label: string | RegExp, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};
const press = (name: string | RegExp) => {
  fireEvent.click(screen.getByRole('button', { name }));
};

/** Stage 1, filled the way a buyer would. */
async function aboutStage(who = '@techedge', title = 'iPhone 13 Pro 256GB') {
  await screen.findByLabelText(/Who's the seller/);
  type(/Who's the seller/, who);
  type('What are you buying?', title);
  type('Agreed price', '452,000');
}

async function toReview() {
  await aboutStage();
  press('Continue');
  await screen.findByText('How should this item get to you?');
  await waitFor(() => {
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Home/ }).checked).toBe(true);
  });
  press('Continue');
  await screen.findByText('Trade terms');
  press('Review');
  await screen.findByRole('button', { name: 'Send Trade proposal' });
}

describe('CT-B1 About', () => {
  it('asks who, what and how much, and detects the category instead of asking', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <BuyerStart />);
    await aboutStage();
    expect(await screen.findByText(/We detected the category: Electronics/)).toBeTruthy();
    expect(screen.queryByLabelText('Category')).toBeNull();
    expect(screen.getByRole('list', { name: 'Start a Trade, step 1 of 4' })).toBeTruthy();
  });

  it('shows what the platform says the buyer pays and never works it out itself', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <BuyerStart />);
    await aboutStage();
    expect(
      await screen.findByText(/You pay ₦458,780.00 including the ₦6,780.00 protection fee/),
    ).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/preview').at(-1)?.body).toEqual({
      role: 'BUYER',
      categoryCode: 'electronics',
      itemAmountMinor: '45200000',
    });
  });

  it('asks for the category only when nothing could be detected', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <BuyerStart />);
    await aboutStage('@techedge', 'Antique chair');
    expect(screen.getByLabelText('Category')).toBeTruthy();
    press('Continue');
    expect(await screen.findByText('Choose a category to carry on')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'fashion' } });
    expect(await screen.findByLabelText('Category')).toBeTruthy();
    press('Continue');
    await screen.findByText('How should this item get to you?');
  });

  it('shows the seller found, and says what is missing without moving on', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <BuyerStart />);
    await screen.findByLabelText(/Who's the seller/);
    press('Continue');
    expect(await screen.findByText('Enter their @username, email address or phone number')).toBeTruthy();
    expect(screen.getByText('Say what you are buying')).toBeTruthy();
    expect(screen.getByText('Enter the price in naira, for example 452,000')).toBeTruthy();

    type(/Who's the seller/, '@techedge');
    fireEvent.blur(screen.getByLabelText(/Who's the seller/));
    expect(await screen.findByText('TechEdge NG')).toBeTruthy();
    expect(screen.getByText(/Profile found · 342 completed trades/)).toBeTruthy();
  });

  it('invites a seller who is not on Komtru, and refuses a username nobody has', async () => {
    answerWith(api.call, handlers());
    const first = renderWithApi(api.call, <BuyerStart />);
    await aboutStage('0802 341 5567');
    fireEvent.blur(screen.getByLabelText(/Who's the seller/));
    expect(await screen.findByText(/They're invited to join/)).toBeTruthy();
    first.unmount();

    answerWith(api.call, handlers({ 'GET /parties/lookup': miss(false) }));
    renderWithApi(api.call, <BuyerStart />);
    await aboutStage('@nobody');
    press('Continue');
    expect(await screen.findByText("We can't find that username")).toBeTruthy();
    expect(screen.queryByText('Item & delivery')).toBeTruthy();
    expect(screen.queryByText('How should this item get to you?')).toBeNull();
  });

  it('says so when the platform will not let this account buy', async () => {
    answerWith(api.call, handlers({ 'POST /trades/preview': preview(['SELLER']) }));
    renderWithApi(api.call, <BuyerStart />);
    await aboutStage();
    expect(await screen.findByText("You can't buy on this account right now")).toBeTruthy();
    press('Continue');
    expect(screen.queryByText('How should this item get to you?')).toBeNull();
  });

  it('is named for a seller by a link, and shows loading and failure of the categories', async () => {
    answerWith(api.call, handlers({ 'GET /config/trade-standards': problem('INTERNAL', 500) }));
    renderWithApi(api.call, <BuyerStart counterparty="@techedge" />);
    expect(await screen.findByText("Couldn't load the categories")).toBeTruthy();
    cleanup();
    api.call.mockReset();
    answerWith(api.call, handlers());
    renderWithApi(api.call, <BuyerStart counterparty="@techedge" />);
    expect(screen.getByRole('status', { name: 'Loading the categories' })).toBeTruthy();
    expect((await screen.findByLabelText<HTMLInputElement>(/Who's the seller/)).value).toBe('@techedge');
  });

  it('says so when there are no categories at all', async () => {
    answerWith(api.call, handlers({ 'GET /config/trade-standards': standardsPage([]) }));
    renderWithApi(api.call, <BuyerStart />);
    expect(await screen.findByText(/no trade categories to choose from yet/)).toBeTruthy();
  });
});

describe('CT-B2 Item & delivery, Courier', () => {
  it('lists what only the seller can say and asks for an address, not for an item description', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <BuyerStart />);
    await aboutStage();
    press('Continue');
    expect(await screen.findByText(/The seller will confirm the item details/)).toBeTruthy();
    expect(screen.getByText(/iPhone 13 Pro 256GB \(from you\)/)).toBeTruthy();
    for (const label of ['Brand', 'Model', 'Condition']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText('Seller provides')).toHaveLength(3);
    expect(screen.queryByLabelText('Brand')).toBeNull();
    expect(await screen.findByText('Where should we deliver it?')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^Courier/ })).toBeTruthy();
  });

  it('keeps Park behind its switch', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <BuyerStart />);
    await aboutStage();
    press('Continue');
    const park = await screen.findByRole<HTMLInputElement>('radio', { name: /Park/ });
    expect(park.disabled).toBe(true);
    expect(screen.getByText(/Coming soon/)).toBeTruthy();
  });

  it('goes back a stage and keeps what was typed', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <BuyerStart />);
    await aboutStage();
    press('Continue');
    await screen.findByText('How should this item get to you?');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText<HTMLInputElement>('What are you buying?').value).toBe('iPhone 13 Pro 256GB');
  });
});

describe('CT-B2P Item & delivery, Park', () => {
  const parks = [
    { id: 'park-jos', name: 'Jos Central Park', detail: 'Terminus area · Open today · 8am–7pm' },
    { id: 'park-ikeja', name: 'Lagos Ikeja Park', detail: 'Ikeja · Open today · 8am–8pm' },
  ];

  it('swaps the address form for a Park chooser and a collection phone', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <BuyerStart parkEnabled parks={parks} />);
    await aboutStage();
    press('Continue');
    fireEvent.click(await screen.findByRole('radio', { name: /Park/ }));
    expect(screen.getByText('Choose a Park')).toBeTruthy();
    expect(screen.getByText(/The Park contacts you on this number/)).toBeTruthy();
    expect(screen.queryByText('Where should we deliver it?')).toBeNull();

    press('Continue');
    expect(await screen.findByText('Choose a Park to carry on.')).toBeTruthy();
    expect(screen.getByText('Enter a phone number the Park can reach you on')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: /Jos Central Park/ }));
    type('Phone', '0803 221 4471');
    press('Continue');
    await screen.findByText('Trade terms');
  });

  it('says there are no Parks when the catalogue is empty', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <BuyerStart parkEnabled parks={[]} />);
    await aboutStage();
    press('Continue');
    fireEvent.click(await screen.findByRole('radio', { name: /Park/ }));
    expect(screen.getByText('No Parks are available to collect from yet.')).toBeTruthy();
  });
});

describe('CT-B3 Trade terms', () => {
  it("shows Komtru's terms as read-only and what the seller will add", async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <BuyerStart />);
    await aboutStage();
    press('Continue');
    await screen.findByText('How should this item get to you?');
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('radio', { name: /Home/ }).checked).toBe(true);
    });
    press('Continue');
    expect(await screen.findByText('Set by Komtru — the same for every Trade')).toBeTruthy();
    expect(screen.getByText(/48 hours · Electronics/)).toBeTruthy();
    expect(screen.getByText('Free before shipment')).toBeTruthy();
    expect(screen.getByText('The seller will add')).toBeTruthy();
    expect(screen.getAllByText('Seller provides')).toHaveLength(2);
    expect(screen.getByText(/You can't change Komtru's protection terms/)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('CT-B4 Review & send', () => {
  it("shows the request with the seller's part waiting, and the platform's own figures", async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <BuyerStart />);
    await toReview();
    expect(screen.getByText('Details to be confirmed by the seller')).toBeTruthy();
    expect(screen.getAllByText('₦452,000.00')).toHaveLength(2);
    expect(screen.getAllByText('Waiting')).toHaveLength(3);
    expect(screen.getByText('TechEdge NG')).toBeTruthy();
    expect(screen.getByText('Buyer Protection Fee')).toBeTruthy();
    expect(screen.getByText('₦6,780.00')).toBeTruthy();
    expect(screen.getByText('₦458,780.00')).toBeTruthy();
    expect(screen.getByText(/The seller must accept before funds can be protected/)).toBeTruthy();
  });

  it('goes back to the start with Edit', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <BuyerStart />);
    await toReview();
    press('Edit');
    expect(await screen.findByLabelText('What are you buying?')).toBeTruthy();
  });

  it("creates the request with the seller's fields waiting, sends it, and shows Sent", async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <BuyerStart />);
    await toReview();
    press('Send Trade proposal');
    expect(await screen.findByText('Sent to TechEdge NG')).toBeTruthy();

    expect(callsTo(api.call, 'POST', '/trades')[0]?.body).toEqual({
      role: 'BUYER',
      categoryCode: 'electronics',
      itemAmountMinor: '45200000',
      itemSpec: {
        requestedItem: 'iPhone 13 Pro 256GB',
        brand: SELLER_TO_CONFIRM,
        model: SELLER_TO_CONFIRM,
        condition: SELLER_TO_CONFIRM,
        deliveryMode: 'COURIER',
      },
      addressId: id(1),
    });
    expect(callsTo(api.call, 'POST', '/trades/:id/send')[0]?.body).toEqual({ username: 'techedge' });
    expect(router.push).not.toHaveBeenCalled();
  });

  it('retries a failed send on the same draft instead of creating a second trade', async () => {
    let sends = 0;
    answerWith(
      api.call,
      handlers({
        'POST /trades/:id/send': () => {
          sends += 1;
          return sends === 1 ? problem('INTERNAL', 500) : sent;
        },
      }),
    );
    renderWithApi(api.call, <BuyerStart />);
    await toReview();
    press('Send Trade proposal');
    expect(await screen.findByText(/We couldn't send that request/)).toBeTruthy();
    press('Send Trade proposal');
    expect(await screen.findByText('Sent to TechEdge NG')).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades')).toHaveLength(1);
    expect(callsTo(api.call, 'POST', '/trades/:id/send')).toHaveLength(2);
  });

  it("shows the platform's own words when it refuses the request", async () => {
    answerWith(
      api.call,
      handlers({ 'POST /trades': problem('VALIDATION_FAILED', 422, 'The price must be more than zero') }),
    );
    renderWithApi(api.call, <BuyerStart />);
    await toReview();
    press('Send Trade proposal');
    expect(await screen.findByText('The price must be more than zero')).toBeTruthy();
  });

  it('opens the trade itself when the platform holds the request for review', async () => {
    answerWith(
      api.call,
      handlers({
        'POST /trades/:id/send': tradeView({ id: id(1), status: 'UNDER_PROPOSAL_REVIEW', yourRole: 'BUYER' }),
      }),
    );
    renderWithApi(api.call, <BuyerStart />);
    await toReview();
    press('Send Trade proposal');
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/trade/${id(1)}`);
    });
  });

  it('withdraws a draft that was created from different terms before making a new one', async () => {
    let sends = 0;
    answerWith(
      api.call,
      handlers({
        'POST /trades/:id/send': () => {
          sends += 1;
          return sends === 1 ? problem('INTERNAL', 500) : sent;
        },
        'POST /trades/:id/cancel': drafted,
      }),
    );
    renderWithApi(api.call, <BuyerStart />);
    await toReview();
    press('Send Trade proposal');
    await screen.findByText(/We couldn't send that request/);
    press('Edit');
    type('Agreed price', '460,000');
    press('Continue');
    await screen.findByText('How should this item get to you?');
    press('Continue');
    await screen.findByText('Trade terms');
    press('Review');
    press('Send Trade proposal');
    await screen.findByText('Sent to TechEdge NG');
    expect(callsTo(api.call, 'POST', '/trades/:id/cancel')).toHaveLength(1);
    expect(callsTo(api.call, 'POST', '/trades')).toHaveLength(2);
  });
});

describe('CT-B5 Sent', () => {
  it('keeps the Trade Code and says what is outstanding', async () => {
    answerWith(api.call, handlers());
    const view = renderWithApi(api.call, <BuyerStart />);
    await toReview();
    press('Send Trade proposal');
    await screen.findByText('Sent to TechEdge NG');
    expect(screen.getByText('KMT-9042800-NG')).toBeTruthy();
    expect(screen.getByText(/Nothing is\s+charged until then/)).toBeTruthy();
    const steps = screen.getByRole('list', { name: 'What happens next' });
    expect(steps.textContent).toContain('TechEdge NG adds their part');
    expect(steps.textContent).toContain('You fund the Trade');
    expect(screen.getByRole('link', { name: 'Back to your trades' }).getAttribute('href')).toBe('/trades');
    await expectNoAxeViolations(view.container, SHELL_RULES);
  });

  it('copies the code', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    answerWith(api.call, handlers());
    renderWithApi(api.call, <BuyerStart />);
    await toReview();
    press('Send Trade proposal');
    await screen.findByText('Sent to TechEdge NG');
    press('Copy');
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('KMT-9042800-NG');
    });
    expect(await screen.findByText('Copied.')).toBeTruthy();
  });
});

describe('accessibility', () => {
  it('has no violations on the first stage', async () => {
    answerWith(api.call, handlers());
    const view = renderWithApi(api.call, <BuyerStart />);
    await aboutStage();
    await expectNoAxeViolations(view.container, SHELL_RULES);
  });
  it('has no violations on the review', async () => {
    answerWith(api.call, handlers());
    const view = renderWithApi(api.call, <BuyerStart />);
    await toReview();
    await expectNoAxeViolations(view.container, SHELL_RULES);
  });
});

describe('Park request submit', () => {
  const parks = [{ id: 'park-jos', name: 'Jos Central Park', detail: 'Terminus area · Open today' }];

  it('creates the Park request with its Park, phone and the buyer address on file', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <BuyerStart parkEnabled parks={parks} />);
    await aboutStage();
    press('Continue');
    fireEvent.click(await screen.findByRole('radio', { name: /Park/ }));
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('radio', { name: /Home/ }).checked).toBe(true);
    });
    fireEvent.click(screen.getByRole('radio', { name: /Jos Central Park/ }));
    type('Phone', '0803 221 4471');
    press('Continue');
    await screen.findByText('Trade terms');
    press('Review');
    await screen.findByText('Park · Jos Central Park');
    press('Send Trade proposal');
    expect(await screen.findByText('Sent to TechEdge NG')).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades')[0]?.body).toMatchObject({
      addressId: id(1),
      itemSpec: {
        deliveryMode: 'PARK',
        parkId: 'park-jos',
        parkName: 'Jos Central Park',
        contactPhone: '0803 221 4471',
      },
    });
  });

  it('does not let a Park request past stage two without an address', async () => {
    answerWith(api.call, handlers({ 'GET /me/addresses': page([]) }));
    renderWithApi(api.call, <BuyerStart parkEnabled parks={parks} />);
    await aboutStage();
    press('Continue');
    fireEvent.click(await screen.findByRole('radio', { name: /Park/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Jos Central Park/ }));
    type('Phone', '0803 221 4471');
    press('Continue');
    expect(await screen.findByText('Choose an address to carry on.')).toBeTruthy();
    expect(screen.queryByText('Trade terms')).toBeNull();
  });
});

describe('sending once', () => {
  it('makes one draft however fast Send is pressed', async () => {
    let release: (value: unknown) => void = () => undefined;
    const slow = new Promise((resolve) => {
      release = resolve;
    });
    answerWith(api.call, handlers());
    const answer = api.call.getMockImplementation() as CallFn;
    api.call.mockImplementation((endpoint, input, options) =>
      endpoint.method.toUpperCase() === 'POST' && endpoint.path === '/trades'
        ? slow.then(() => answer(endpoint, input, options))
        : answer(endpoint, input, options),
    );
    renderWithApi(api.call, <BuyerStart />);
    await toReview();
    const send = screen.getByRole('button', { name: 'Send Trade proposal' });
    fireEvent.click(send);
    fireEvent.click(send);
    fireEvent.click(send);
    release(undefined);
    expect(await screen.findByText('Sent to TechEdge NG')).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades')).toHaveLength(1);
    expect(callsTo(api.call, 'POST', '/trades/:id/send')).toHaveLength(1);
  });

  it('still makes the new draft when withdrawing the old one fails', async () => {
    let sends = 0;
    answerWith(
      api.call,
      handlers({
        'POST /trades/:id/send': () => {
          sends += 1;
          return sends === 1 ? problem('INTERNAL', 500) : sent;
        },
        'POST /trades/:id/cancel': problem('INTERNAL', 500),
      }),
    );
    renderWithApi(api.call, <BuyerStart />);
    await toReview();
    press('Send Trade proposal');
    await screen.findByText(/We couldn't send that request/);
    press('Edit');
    type('Agreed price', '460,000');
    press('Continue');
    await screen.findByText('How should this item get to you?');
    press('Continue');
    await screen.findByText('Trade terms');
    press('Review');
    press('Send Trade proposal');
    expect(await screen.findByText('Sent to TechEdge NG')).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/:id/cancel')).toHaveLength(1);
    expect(callsTo(api.call, 'POST', '/trades')).toHaveLength(2);
  });
});

describe('moving between stages', () => {
  it('moves focus to the rail that names the new stage', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <BuyerStart />);
    await aboutStage();
    press('Continue');
    await screen.findByText('How should this item get to you?');
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('list', { name: 'Start a Trade, step 2 of 4' }));
    });
  });
});

describe('DX-10 / TX-07 contract so far beside the stage', () => {
  it('is not drawn on the first stage, where it would repeat the seller and item being typed', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <BuyerStart />);
    await aboutStage();
    expect(screen.queryByRole('complementary', { name: 'Contract so far' })).toBeNull();
  });

  it('draws the figures the platform gave, beside item and delivery, and says the total is still to come', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <BuyerStart />);
    await aboutStage();
    press('Continue');
    await screen.findByText('How should this item get to you?');
    const contract = await screen.findByRole('complementary', { name: 'Contract so far' });
    expect(within(contract).getByText('iPhone 13 Pro 256GB')).toBeTruthy();
    expect(within(contract).getByText('Buyer Protection Fee')).toBeTruthy();
    expect(within(contract).getByText('To be confirmed')).toBeTruthy();
    expect(within(contract).getByText('Seller to add')).toBeTruthy();
  });

  it('is named by the trade assembly rail, with the stage the person is on marked', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <BuyerStart />);
    await aboutStage();
    press('Continue');
    await screen.findByText('How should this item get to you?');
    const rail = screen.getByRole('navigation', { name: 'Trade assembly' });
    expect(
      within(rail)
        .getByRole('list', { name: /step 2 of 4/ })
        .getAttribute('aria-label'),
    ).toMatch(/step 2 of 4/);
  });
});
