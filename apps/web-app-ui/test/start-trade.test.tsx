// @vitest-environment jsdom
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StartTrade } from '../src/trade/StartTrade';
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

const baseHandlers = (over: Record<string, unknown> = {}) => ({
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
  window.localStorage.clear();
});
afterEach(cleanup);

const type = (label: string | RegExp, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

/** Fills the item the way a buyer would, and names the seller by handle. */
async function fillBuyer(who = '@techedge') {
  await screen.findByLabelText('Brand');
  type('Brand', 'Apple');
  type('Model', 'iPhone 13 Pro');
  type('Condition', 'Sealed box');
  type('Price', '452,000');
  type(/The seller/, who);
}

describe('Start Trade (I3)', () => {
  it('sends a buyer proposal: creates the draft against the standard, then sends it to the seller', async () => {
    answerWith(api.call, baseHandlers());
    renderWithApi(api.call, <StartTrade />);
    await fillBuyer();
    // The default address is chosen for them.
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('radio', { name: /Home/ }).checked).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Send Trade request' }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/trade/${id(1)}`);
    });

    expect(callsTo(api.call, 'POST', '/trades')[0]?.body).toEqual({
      role: 'BUYER',
      categoryCode: 'electronics',
      itemAmountMinor: '45200000',
      itemSpec: { brand: 'Apple', model: 'iPhone 13 Pro', condition: 'Sealed box' },
      addressId: id(1),
    });
    const send = callsTo(api.call, 'POST', '/trades/:id/send')[0];
    expect(send?.params).toEqual({ id: id(1) });
    expect(send?.body).toEqual({ username: 'techedge' });
  });

  it('shows what the buyer pays from the platform, and never works it out itself', async () => {
    answerWith(api.call, baseHandlers());
    renderWithApi(api.call, <StartTrade />);
    await screen.findByLabelText('Brand');
    type('Price', '452,000');
    expect(
      await screen.findByText(/The buyer pays ₦458,780.00 including the ₦6,780.00 protection fee/),
    ).toBeTruthy();
    const previews = callsTo(api.call, 'POST', '/trades/preview');
    expect(previews.at(-1)?.body).toMatchObject({
      role: 'BUYER',
      categoryCode: 'electronics',
      itemAmountMinor: '45200000',
    });
  });

  it('offers both sides to someone who can take both, and only selling to a certified merchant', async () => {
    answerWith(api.call, baseHandlers());
    const first = renderWithApi(api.call, <StartTrade />);
    await screen.findByLabelText('Brand');
    expect(await screen.findByRole('radio', { name: /I'm selling/ })).toBeTruthy();
    first.unmount();

    answerWith(api.call, baseHandlers({ 'POST /trades/preview': preview(['SELLER']) }));
    renderWithApi(api.call, <StartTrade defaultRole="BUYER" />);
    await screen.findByLabelText('Brand');
    await waitFor(() => {
      expect(screen.queryByRole('radio', { name: /I'm buying/ })).toBeNull();
    });
    // Sending as the only side they have: the buyer is named, and the seller's address is "Ships from".
    expect(await screen.findByText('Ships from')).toBeTruthy();
  });

  it('asks a seller for proof of the item and holds the send back until it is attached', async () => {
    answerWith(api.call, baseHandlers());
    renderWithApi(api.call, <StartTrade defaultRole="SELLER" />);
    await screen.findByLabelText('Brand');
    expect(await screen.findByText('Proof of the item')).toBeTruthy();
    expect(
      screen.getByText(
        /Attach 2 photos or video of the item in your possession before you can send this proposal/,
      ),
    ).toBeTruthy();
    type('Brand', 'Apple');
    type('Model', 'iPhone');
    type('Condition', 'Sealed');
    type('Price', '452,000');
    type(/The buyer/, '@amaka');
    fireEvent.click(screen.getByRole('button', { name: 'Send Trade request' }));
    expect(await screen.findByText('Add proof of the item to carry on.')).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades')).toHaveLength(0);
  });

  it('says what is missing, one thing at a time, and sends nothing', async () => {
    answerWith(api.call, baseHandlers());
    renderWithApi(api.call, <StartTrade />);
    await screen.findByLabelText('Brand');
    fireEvent.click(screen.getByRole('button', { name: 'Send Trade request' }));
    expect(await screen.findByText('Add the brand to carry on.')).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades')).toHaveLength(0);
    type('Brand', 'Apple');
    type('Model', 'iPhone');
    type('Condition', 'Sealed');
    fireEvent.click(screen.getByRole('button', { name: 'Send Trade request' }));
    expect(await screen.findByText('Enter the price to carry on.')).toBeTruthy();
  });

  it('blocks a seller naming a certified merchant as the buyer, before anything is created', async () => {
    answerWith(api.call, baseHandlers({ 'GET /parties/lookup': party({ canBuy: false, isMerchant: true }) }));
    renderWithApi(api.call, <StartTrade defaultRole="SELLER" />);
    await screen.findByLabelText('Brand');
    type(/The buyer/, '@bigshop');
    fireEvent.blur(screen.getByLabelText(/The buyer/));
    expect(await screen.findByText("They can't be the buyer")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send Trade request' }).disabled).toBe(true);
  });

  it('lets a buyer name a merchant as the seller: a merchant selling is the point', async () => {
    answerWith(api.call, baseHandlers({ 'GET /parties/lookup': party({ canBuy: false, isMerchant: true }) }));
    renderWithApi(api.call, <StartTrade />);
    await fillBuyer('@bigshop');
    fireEvent.click(screen.getByRole('button', { name: 'Send Trade request' }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalled();
    });
  });

  it('invites someone who is not on Komtru by phone, and says how the invitation works', async () => {
    answerWith(api.call, baseHandlers());
    renderWithApi(api.call, <StartTrade />);
    await fillBuyer('0802 341 5567');
    fireEvent.blur(screen.getByLabelText(/The seller/));
    expect(await screen.findByText(/they're invited to join/)).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/parties/lookup')[0]?.body).toEqual({ phone: '08023415567' });

    fireEvent.click(screen.getByRole('button', { name: 'Send Trade request' }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalled();
    });
    expect(callsTo(api.call, 'POST', '/trades/:id/send')[0]?.body).toEqual({ phone: '08023415567' });
  });

  it('does not invite a username nobody has: a handle cannot be invited', async () => {
    answerWith(api.call, baseHandlers({ 'GET /parties/lookup': miss(false) }));
    renderWithApi(api.call, <StartTrade />);
    await fillBuyer('@nobody');
    fireEvent.click(screen.getByRole('button', { name: 'Send Trade request' }));
    expect(await screen.findByText("We can't find that username")).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades')).toHaveLength(0);
  });

  it('retries a failed send on the same draft instead of creating a second trade', async () => {
    let sends = 0;
    answerWith(
      api.call,
      baseHandlers({
        'POST /trades/:id/send': () => {
          sends += 1;
          return sends === 1 ? problem('INTERNAL', 500) : sent;
        },
      }),
    );
    renderWithApi(api.call, <StartTrade />);
    await fillBuyer();
    fireEvent.click(screen.getByRole('button', { name: 'Send Trade request' }));
    expect(await screen.findByText(/We couldn't send that request/)).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Send Trade request' }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/trade/${id(1)}`);
    });
    expect(callsTo(api.call, 'POST', '/trades')).toHaveLength(1);
    expect(callsTo(api.call, 'POST', '/trades/:id/send')).toHaveLength(2);
  });

  it("shows the platform's own words when it refuses the proposal", async () => {
    answerWith(
      api.call,
      baseHandlers({
        'POST /trades': problem('VALIDATION_FAILED', 422, 'The item details are incomplete'),
      }),
    );
    renderWithApi(api.call, <StartTrade />);
    await fillBuyer();
    fireEvent.click(screen.getByRole('button', { name: 'Send Trade request' }));
    expect(await screen.findByText('The item details are incomplete')).toBeTruthy();
  });

  it('shows the add-address form when there are no saved addresses, and chooses the one it saves', async () => {
    const saved = address(5, { label: 'Shop', isDefault: true });
    let list = page<unknown>([]);
    answerWith(api.call, {
      ...baseHandlers(),
      'GET /me/addresses': () => list,
      'GET /geo/states': page([{ id: id(70), code: 'LA', name: 'Lagos' }]),
      'GET /geo/states/:stateId/cities': page([{ id: id(71), stateId: id(70), name: 'Ikeja', active: true }]),
      'POST /me/addresses': () => {
        list = page([saved]);
        return saved;
      },
    });
    renderWithApi(api.call, <StartTrade />);
    await screen.findByLabelText('Brand');
    type('Name for this address', 'Shop');
    type('Recipient name', 'Ada Obi');
    type('Recipient phone', '08012345678');
    type('Street address', '12 Allen Avenue');
    await screen.findByRole('option', { name: 'Lagos' });
    type('State', id(70));
    await screen.findByRole('option', { name: 'Ikeja' });
    type('City', id(71));
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('radio', { name: /Shop/ }).checked).toBe(true);
    });
    expect(callsTo(api.call, 'POST', '/me/addresses')[0]?.body).toMatchObject({
      label: 'Shop',
      stateId: id(70),
      cityId: id(71),
      landmark: null,
    });
  });

  it('opens with the other party already named when it is given one', async () => {
    answerWith(api.call, baseHandlers());
    renderWithApi(api.call, <StartTrade counterparty="techedge" />);
    expect((await screen.findByLabelText<HTMLInputElement>(/The seller/)).value).toBe('techedge');
  });

  it('proposes what is on screen when the person edits after a failed send, not the draft it already made', async () => {
    let sends = 0;
    let created = 0;
    answerWith(
      api.call,
      baseHandlers({
        'POST /trades': () => {
          created += 1;
          return tradeView({ id: id(10 + created), status: 'DRAFT', awaiting: null, yourRole: 'BUYER' });
        },
        'POST /trades/:id/send': ({ params }: { params?: Record<string, string> }) => {
          sends += 1;
          return sends === 1
            ? problem('INTERNAL', 500)
            : tradeView({
                id: params?.id ?? id(1),
                status: 'AWAITING_ACCEPTANCE',
                awaiting: 'COUNTERPARTY',
                yourRole: 'BUYER',
              });
        },
        'POST /trades/:id/cancel': tradeView({ status: 'CANCELLED', awaiting: null }),
      }),
    );
    renderWithApi(api.call, <StartTrade />);
    await fillBuyer();
    fireEvent.click(screen.getByRole('button', { name: 'Send Trade request' }));
    expect(await screen.findByText(/We couldn't send that request/)).toBeTruthy();

    // The person notices the price is wrong and fixes it before trying again.
    type('Price', '399,000');
    fireEvent.click(screen.getByRole('button', { name: 'Send Trade request' }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/trade/${id(12)}`);
    });

    const drafts = callsTo(api.call, 'POST', '/trades');
    expect(drafts).toHaveLength(2);
    expect(drafts[0]?.body).toMatchObject({ itemAmountMinor: '45200000' });
    expect(drafts[1]?.body).toMatchObject({ itemAmountMinor: '39900000' });
    // The proposal that went out is the new draft, and the old one was withdrawn, not left to be sent.
    expect(callsTo(api.call, 'POST', '/trades/:id/send').map((call) => call.params?.id)).toEqual([
      id(11),
      id(12),
    ]);
    expect(callsTo(api.call, 'POST', '/trades/:id/cancel')[0]?.params).toEqual({ id: id(11) });
  });

  it('changes the draft when the side, the category or the address changes too', async () => {
    let created = 0;
    answerWith(
      api.call,
      baseHandlers({
        'GET /me/addresses': page([address(1), address(2, { label: 'Shop' })]),
        'POST /trades': () => {
          created += 1;
          return tradeView({ id: id(20 + created), status: 'DRAFT', awaiting: null, yourRole: 'BUYER' });
        },
        'POST /trades/:id/send': problem('INTERNAL', 500),
        'POST /trades/:id/cancel': tradeView({ status: 'CANCELLED', awaiting: null }),
      }),
    );
    renderWithApi(api.call, <StartTrade />);
    await fillBuyer();
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('radio', { name: /Home/ }).checked).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Trade request' }));
    await screen.findByText(/We couldn't send that request/);
    fireEvent.click(screen.getByRole('radio', { name: /Shop/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send Trade request' }));
    await waitFor(() => {
      expect(callsTo(api.call, 'POST', '/trades')).toHaveLength(2);
    });
    expect(callsTo(api.call, 'POST', '/trades')[1]?.body).toMatchObject({ addressId: id(2) });
  });

  it('shows the shape of the page while the categories load, and offers a retry if they cannot', async () => {
    api.call.mockImplementation(() => new Promise(() => undefined));
    const first = renderWithApi(api.call, <StartTrade />);
    expect(screen.getByRole('status', { name: 'Loading the categories' })).toBeTruthy();
    first.unmount();

    answerWith(api.call, baseHandlers({ 'GET /config/trade-standards': new Error('offline') }));
    renderWithApi(api.call, <StartTrade />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('has no accessibility violations', async () => {
    answerWith(api.call, baseHandlers());
    const { container } = renderWithApi(api.call, <StartTrade />);
    await screen.findByLabelText('Brand');
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});
