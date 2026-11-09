// @vitest-environment jsdom
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TradeScreen } from '../src/trade/TradeScreen';
import { knownTradeIds } from '../src/trade/known-trades';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  address,
  answerWith,
  callsTo,
  id,
  page,
  renderWithApi,
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

const withTrade = (view: unknown, more: Record<string, unknown> = {}) =>
  answerWith(api.call, { 'GET /trades/:id': view, 'GET /me/addresses': page([address(1)]), ...more });

beforeEach(() => {
  api.call.mockReset();
  router.push.mockReset();
  window.localStorage.clear();
});
afterEach(cleanup);

describe('opening a trade', () => {
  it('adds a trade somebody opens to the list on this device', async () => {
    withTrade(tradeView({ status: 'PENDING_PAYMENT', awaiting: null }));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await screen.findByRole('heading', { name: 'Terms agreed' });
    expect(knownTradeIds()).toEqual([id(1)]);
  });

  it('says a trade cannot be found, with no retry, when the platform says 404', async () => {
    withTrade(problem('NOT_FOUND', 404));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByText("We can't find that trade. It may have been withdrawn.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(knownTradeIds()).toEqual([]);
  });

  it('offers a retry for any other failure', async () => {
    withTrade(new Error('offline'));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('a proposal waiting on the seller (R1)', () => {
  const request = () => tradeView();

  it("shows the item, the buyer's terms and the three ways to answer", async () => {
    withTrade(request());
    const { container } = renderWithApi(api.call, <TradeScreen id={id(1)} />);

    expect(await screen.findByText('Apple iPhone 13 Pro')).toBeTruthy();
    expect(screen.getAllByText('₦452,000.00').length).toBeGreaterThan(0);
    const terms = screen.getByLabelText('Terms of this trade');
    expect(within(terms).getByText('Inspection').nextElementSibling?.textContent).toContain('48 hours');
    expect(within(terms).getByText('Delivery to').nextElementSibling?.textContent).toBe(
      '5 Adeola Odeku, Victoria Island',
    );
    expect(screen.getByRole('button', { name: 'Accept trade request' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Propose a change' }).getAttribute('href')).toBe(
      `/trade/${id(1)}/counter`,
    );
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('keeps Accept locked until there is proof of the item', async () => {
    withTrade(request());
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    const accept = await screen.findByRole<HTMLButtonElement>('button', { name: 'Accept trade request' });
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('radio', { name: /Home/ }).checked).toBe(true);
    });
    expect(accept.disabled).toBe(true);
    expect(screen.getByText('Proof of the item needed')).toBeTruthy();
  });

  it('accepts the version on screen with the chosen address and the uploaded proof', async () => {
    withTrade(request(), {
      'POST /files/upload-url': {
        fileId: id(90),
        cloudName: 'komtru',
        uploadUrl: 'https://upload.test/x',
        params: { signature: 's' },
        maxBytes: 5_000_000,
        expiresAt: '2026-11-09T12:00:00.000Z',
      },
      'POST /files/:id/finalize': { fileId: id(90), uploadState: 'PENDING' },
      'POST /trades/:id/accept': tradeView({ status: 'PENDING_PAYMENT', awaiting: null }),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))),
    );
    const { container } = renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await screen.findByText('Apple iPhone 13 Pro');
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('radio', { name: /Home/ }).checked).toBe(true);
    });

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['x'], 'front.jpg', { type: 'image/jpeg' })] },
    });
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Accept trade request' }).disabled).toBe(
        false,
      );
    });
    expect(callsTo(api.call, 'POST', '/files/upload-url')[0]?.body).toEqual({
      category: 'OTHER',
      visibility: 'PRIVATE_CASE',
      contentType: 'image/jpeg',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Accept trade request' }));
    expect(await screen.findByRole('heading', { name: 'Terms agreed' })).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/:id/accept')[0]?.body).toEqual({
      termsVersionId: id(40),
      addressId: id(1),
      proofFileIds: [id(90)],
    });
    vi.unstubAllGlobals();
  });

  it('declines with a reason after one confirmation, and shows the trade as ended', async () => {
    withTrade(request(), {
      'POST /trades/:id/decline': tradeView({ status: 'DECLINED', awaiting: null }),
    });
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    const sheet = await screen.findByRole('dialog', { name: 'Decline this request' });
    fireEvent.change(within(sheet).getByLabelText('Reason'), { target: { value: 'Price is too low' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Decline request' }));
    expect(await screen.findByRole('heading', { name: 'Request declined' })).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/:id/decline')[0]?.body).toEqual({ reason: 'Price is too low' });
  });

  it("shows the platform's reason when the accept is refused", async () => {
    withTrade(request(), {
      'POST /trades/:id/accept': problem(
        'VALIDATION_FAILED',
        422,
        'Attach 1 more photo before this trade can move to payment.',
      ),
      'POST /files/upload-url': {
        fileId: id(90),
        cloudName: 'k',
        uploadUrl: 'https://upload.test/x',
        params: {},
        maxBytes: 9_999_999,
        expiresAt: 'x',
      },
      'POST /files/:id/finalize': { fileId: id(90), uploadState: 'PENDING' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))),
    );
    const { container } = renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await screen.findByText('Apple iPhone 13 Pro');
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('radio', { name: /Home/ }).checked).toBe(true);
    });
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] },
    });
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Accept trade request' }).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole('button', { name: 'Accept trade request' }));
    expect(
      await screen.findByText('Attach 1 more photo before this trade can move to payment.'),
    ).toBeTruthy();
    vi.unstubAllGlobals();
  });
});

describe('a proposal waiting on the buyer (Customer-2)', () => {
  it('asks for a delivery address, not proof, and accepts without any', async () => {
    withTrade(
      tradeView({
        initiatorRole: 'SELLER',
        yourRole: 'BUYER',
        terms: {
          ...tradeView().terms,
          proposedByRole: 'SELLER',
          deliveryAddress: null,
          shipsFromAddress: { street: '1 Marina' },
        },
      }),
      {
        'POST /trades/:id/accept': tradeView({
          status: 'PENDING_PAYMENT',
          awaiting: null,
          yourRole: 'BUYER',
        }),
      },
    );
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByText('Delivery address')).toBeTruthy();
    expect(screen.queryByText('Proof of the item')).toBeNull();
    const accept = screen.getByRole<HTMLButtonElement>('button', { name: 'Accept terms' });
    await waitFor(() => {
      expect(accept.disabled).toBe(false);
    });
    fireEvent.click(accept);
    await screen.findByRole('heading', { name: 'Terms agreed' });
    expect(callsTo(api.call, 'POST', '/trades/:id/accept')[0]?.body).toEqual({
      termsVersionId: id(40),
      addressId: id(1),
    });
  });
});

describe('waiting on the other party, and the invite', () => {
  it('shows a sent request with its Trade Code and lets the sender withdraw it after one confirmation', async () => {
    withTrade(tradeView({ yourRole: 'BUYER', awaiting: 'COUNTERPARTY' }), {
      'POST /trades/:id/cancel': tradeView({ yourRole: 'BUYER', status: 'CANCELLED', awaiting: null }),
    });
    const { container } = renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByRole('heading', { name: 'Request sent' })).toBeTruthy();
    expect(screen.getByText('KMT-90428').className).toContain('font-mono');
    await expectNoAxeViolations(container, SHELL_RULES);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel this request' }));
    const sheet = await screen.findByRole('dialog', { name: 'Cancel this request' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel request' }));
    expect(await screen.findByRole('heading', { name: 'Request cancelled' })).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/:id/cancel')).toHaveLength(1);
  });

  it('tells the sender of an invitation that the request waits for the person to join', async () => {
    withTrade(tradeView({ yourRole: 'BUYER', status: 'PENDING_COUNTERPARTY', awaiting: null }));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByRole('heading', { name: 'Invitation waiting' })).toBeTruthy();
    expect(screen.getByText(/They're not on Komtru yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Withdraw the invitation' })).toBeTruthy();
  });

  it('lets an invited person take their place', async () => {
    withTrade(
      tradeView({
        yourRole: 'SELLER',
        initiatorRole: 'BUYER',
        status: 'PENDING_COUNTERPARTY',
        awaiting: null,
      }),
      {
        'POST /trades/:id/claim': tradeView({ status: 'AWAITING_ACCEPTANCE', awaiting: 'YOU' }),
      },
    );
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Take your place' }));
    expect(await screen.findByRole('button', { name: 'Accept trade request' })).toBeTruthy();
  });

  it('sends the person to add an address when the claim needs one', async () => {
    withTrade(
      tradeView({
        yourRole: 'SELLER',
        initiatorRole: 'BUYER',
        status: 'PENDING_COUNTERPARTY',
        awaiting: null,
      }),
      {
        'POST /trades/:id/claim': problem('ADDRESS_REQUIRED', 422),
      },
    );
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Take your place' }));
    expect(await screen.findByText('Choose or add a saved address first.')).toBeTruthy();
  });
});

describe('held for review (G3) and not sent (IF1)', () => {
  it('says the proposal is held, that it is not a judgment, and keeps the Trade Code', async () => {
    withTrade(
      tradeView({
        yourRole: 'BUYER',
        status: 'UNDER_PROPOSAL_REVIEW',
        awaiting: null,
        tradeCode: 'KMT-90138',
      }),
    );
    const { container } = renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByRole('heading', { name: 'Held for review' })).toBeTruthy();
    expect(screen.getByText(/This isn't a judgment about you/)).toBeTruthy();
    expect(screen.getByText('KMT-90138')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to your trades' }).getAttribute('href')).toBe('/trades');
    // No ID upload: the platform has no route that takes it.
    expect(screen.queryByText(/Upload a government-issued ID/)).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says a rejected proposal did not go ahead, without blaming anyone', async () => {
    withTrade(tradeView({ yourRole: 'BUYER', status: 'REJECTED', awaiting: null }));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByRole('heading', { name: "This proposal can't go ahead" })).toBeTruthy();
    expect(screen.getByText("This isn't automatically your fault")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start a new trade' }).getAttribute('href')).toBe('/trade/new');
  });
});

describe('terms agreed (TC-06)', () => {
  const agreed = (over: Record<string, unknown> = {}) =>
    tradeView({
      status: 'PENDING_PAYMENT',
      awaiting: null,
      statusRevision: 5,
      fees: {
        scheduleVersion: '2026-10-05.1',
        itemAmountMinor: '45200000',
        buyerProtectionFeeMinor: '678000',
        buyerTotalMinor: '45878000',
        commissionMinor: '0',
        sellerProceedsMinor: '45200000',
      },
      ...over,
      terms: { ...tradeView().terms, versionNumber: 3, ...(over.terms ?? {}) },
    });

  it("shows the buyer the exact total from the trade's own fee snapshot and the versions it went through", async () => {
    withTrade(agreed({ yourRole: 'BUYER', initiatorRole: 'BUYER' }));
    const { container } = renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByRole('heading', { name: 'Terms agreed' })).toBeTruthy();
    expect(screen.getByText('Agreement recorded')).toBeTruthy();
    const fees = screen.getByLabelText('What this comes to');
    expect(within(fees).getByText('You pay').nextElementSibling?.textContent).toBe('₦458,780.00');
    expect(within(fees).getByText('Buyer protection fee').nextElementSibling?.textContent).toBe('₦6,780.00');

    const versions = within(screen.getByRole('list', { name: 'Versions of this agreement' })).getAllByRole(
      'listitem',
    );
    expect(versions.map((item) => item.querySelector('b')?.textContent)).toEqual([
      'Version 1 · Buyer proposal',
      'Version 2 · Seller counter',
      'Version 3 · Accepted',
    ]);
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('shows the seller what they receive, and does not offer a payment button that does nothing', async () => {
    withTrade(agreed({ yourRole: 'SELLER' }));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    const fees = await screen.findByLabelText('What this comes to');
    expect(within(fees).getByText('You receive').nextElementSibling?.textContent).toBe('₦452,000.00');
    expect(screen.queryByRole('button', { name: /payment|fund/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /payment|fund/i })).toBeNull();
  });
});

describe('ended and moved-on trades', () => {
  it.each([
    ['DECLINED', 'Request declined'],
    ['CANCELLED', 'Request cancelled'],
    ['EXPIRED', 'Request expired'],
  ])('says %s plainly and offers a new trade', async (status, heading) => {
    withTrade(tradeView({ status, awaiting: null }));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start a new trade' })).toBeTruthy();
  });

  it('shows a trade past the agreement as a plain summary rather than guessing at its state', async () => {
    withTrade(tradeView({ status: 'FUNDED', awaiting: null }));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByRole('heading', { name: 'KMT-90428' })).toBeTruthy();
    expect(screen.getByLabelText('Terms of this trade')).toBeTruthy();
  });
});
