// @vitest-environment jsdom
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TradeScreen } from '../src/trade/TradeScreen';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  address,
  answerWith,
  counterparty,
  electronics,
  callsTo,
  id,
  page,
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

let uploads = 0;
const withTrade = (view: unknown, more: Record<string, unknown> = {}) =>
  answerWith(api.call, {
    'GET /trades/:id': view,
    'GET /me/addresses': page([address(1)]),
    'GET /config/trade-standards': standardsPage(),
    'GET /config/trade-standards/versions/:id': ({ params }: { params?: Record<string, string> }) =>
      standardsPage().items.find((item) => item.versionId === params?.id),
    'GET /trades': page([]),
    ...more,
  });

beforeEach(() => {
  api.call.mockReset();
  router.push.mockReset();
  uploads = 0;
  window.localStorage.clear();
});
afterEach(cleanup);

describe('opening a trade', () => {
  it('says a trade cannot be found (SP-M19), with no retry, when the platform says 404', async () => {
    withTrade(problem('NOT_FOUND', 404));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByRole('heading', { name: 'We can’t find that Trade' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
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
    // The category's own standard sets the count: electronics asks for two photos.
    expect(await screen.findByText(/Attach 2 photos or video of the item/)).toBeTruthy();
  });

  it('accepts the version on screen with the chosen address and the uploaded proof', async () => {
    withTrade(request(), {
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
      target: {
        files: [
          new File(['x'], 'front.jpg', { type: 'image/jpeg' }),
          new File(['x'], 'back.jpg', { type: 'image/jpeg' }),
        ],
      },
    });
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Accept trade request' }).disabled).toBe(
        false,
      );
    });
    // PROOF_OF_DELIVERY, not OTHER. This assertion used to require the pair the platform refuses:
    // `OTHER` may only be PRIVATE_OWNER or INTERNAL_ONLY, so the upload it described returned 403
    // every time and the test still passed, because it checked what was sent rather than what came
    // back. `UploadTarget` in @komtru/shared-types makes the old pair a compile error.
    expect(callsTo(api.call, 'POST', '/files/upload-url')[0]?.body).toEqual({
      category: 'PROOF_OF_DELIVERY',
      visibility: 'PRIVATE_CASE',
      contentType: 'image/jpeg',
    });

    // What was attached is shown as the person's own files, never as an id.
    expect(container.textContent).not.toContain(id(90));
    expect(container.textContent).not.toContain(id(91));

    fireEvent.click(screen.getByRole('button', { name: 'Accept trade request' }));
    expect(await screen.findByRole('heading', { name: 'Terms agreed' })).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/:id/accept')[0]?.body).toEqual({
      termsVersionId: id(40),
      addressId: id(1),
      proofFileIds: [id(90), id(91)],
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
      target: {
        files: [
          new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
          new File(['x'], 'b.jpg', { type: 'image/jpeg' }),
        ],
      },
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

describe('who is on the other side', () => {
  it("shows the counterparty the trade carries: R1's buyer strip", async () => {
    withTrade(tradeView());
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByText('Amaka B.')).toBeTruthy();
    expect(screen.getByText('AB')).toBeTruthy();
  });

  it('does not read the trades list at all, so it is right for the twenty-first trade too', async () => {
    withTrade(tradeView());
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await screen.findByText('Amaka B.');
    expect(callsTo(api.call, 'GET', '/trades')).toHaveLength(0);
  });

  it('falls back to the handle, and draws no strip when the platform has no counterparty to show', async () => {
    withTrade(tradeView({ counterparty: counterparty({ displayName: null }) }));
    const first = renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByText('@amaka')).toBeTruthy();
    first.unmount();

    withTrade(tradeView({ counterparty: null }));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await screen.findByText('Apple iPhone 13 Pro');
    expect(screen.queryByText('Amaka B.')).toBeNull();
    expect(screen.queryByText('A Komtru member')).toBeNull();
  });
});

describe('the proof the pinned standard asks for', () => {
  const version = (over: Record<string, unknown>) => ({ ...electronics, ...over });
  const withPinned = (pinned: Record<string, unknown>, more: Record<string, unknown> = {}) =>
    withTrade(tradeView({ standardVersionId: pinned.versionId }), {
      'GET /config/trade-standards/versions/:id': pinned,
      ...more,
    });

  it("asks for exactly the pinned standard's photos: electronics two", async () => {
    withTrade(tradeView());
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByText(/Attach 2 photos or video of the item/)).toBeTruthy();
    expect(callsTo(api.call, 'GET', '/config/trade-standards/versions/:id')[0]?.params).toEqual({
      id: id(60),
    });
  });

  it('still demands what the trade froze after a newer standard has been published', async () => {
    // The trade froze version 1 (four photos and a video). The category's CURRENT standard is now looser.
    const frozen = version({
      versionId: id(62),
      versionNumber: 1,
      proofMedia: { minPhotos: 4, requireVideo: true },
    });
    const newer = version({
      versionId: id(63),
      versionNumber: 2,
      proofMedia: { minPhotos: 1, requireVideo: false },
    });
    withPinned(frozen, { 'GET /config/trade-standards': standardsPage([newer]) });
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByText(/Attach 4 photos and a video of the item/)).toBeTruthy();
    // It read the frozen version by its id and never fell back to the category's current one.
    expect(callsTo(api.call, 'GET', '/config/trade-standards/versions/:id')[0]?.params).toEqual({
      id: id(62),
    });
    expect(callsTo(api.call, 'GET', '/config/trade-standards')).toHaveLength(0);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Accept trade request' }).disabled).toBe(
      true,
    );
  });

  it('needs a video as well as the photos when the pinned standard says so', async () => {
    withPinned(version({ versionId: id(64), proofMedia: { minPhotos: 1, requireVideo: true } }), {
      'POST /files/upload-url': () => {
        uploads += 1;
        return {
          fileId: id(89 + uploads),
          cloudName: 'k',
          uploadUrl: 'https://upload.test/x',
          params: {},
          maxBytes: 9_999_999,
          expiresAt: 'x',
        };
      },
      'POST /files/:id/finalize': ({ params }: { params?: Record<string, string> }) => ({
        fileId: params?.id,
        uploadState: 'PENDING',
      }),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))),
    );
    const { container } = renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await screen.findByText(/Attach 1 photo and a video/);
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('radio', { name: /Home/ }).checked).toBe(true);
    });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } });
    await screen.findByText(/Attach 1 more/);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Accept trade request' }).disabled).toBe(
      true,
    );
    fireEvent.change(input, { target: { files: [new File(['x'], 'v.mp4', { type: 'video/mp4' })] } });
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Accept trade request' }).disabled).toBe(
        false,
      );
    });
    vi.unstubAllGlobals();
  });

  it('keeps the platform floor of one photo when the standard asks for none and no video', async () => {
    withPinned(version({ versionId: id(61), proofMedia: { minPhotos: 0, requireVideo: false } }));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByText(/Attach 1 photo or video of the item/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Accept trade request' }).disabled).toBe(
      true,
    );
  });

  it('is an error, not a lower bar, when the pinned standard cannot be read', async () => {
    withTrade(tradeView(), { 'GET /config/trade-standards/versions/:id': new Error('offline') });
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByText("Couldn't load what proof this trade needs")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Accept trade request' }).disabled).toBe(
      true,
    );
    expect(screen.queryByText(/Attach \d/)).toBeNull();
  });

  it('shows the buyer no proof section and does not read the standard at all', async () => {
    withTrade(tradeView({ yourRole: 'BUYER', initiatorRole: 'SELLER' }));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await screen.findByText('Delivery address');
    expect(screen.queryByText('Proof of the item')).toBeNull();
    expect(callsTo(api.call, 'GET', '/config/trade-standards/versions/:id')).toHaveLength(0);
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
    expect(screen.getByText('KMT-9042800-NG').className).toContain('font-mono');
    await expectNoAxeViolations(container, SHELL_RULES);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel this request' }));
    const sheet = await screen.findByRole('dialog', { name: 'Cancel this request' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel request' }));
    expect(await screen.findByRole('heading', { name: 'Request cancelled' })).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/:id/cancel')).toHaveLength(1);
  });

  it('offers the sender the platform link and says the receiver still needs the right account', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    withTrade(tradeView({ yourRole: 'BUYER', status: 'PENDING_COUNTERPARTY', awaiting: null }));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy the link' }));
    expect(writeText).toHaveBeenCalledWith('https://app.komtru.com/trades/KMT-9042800-NG');
    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeTruthy();
    expect(screen.getByText(/lets no one in/)).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('tells the sender of an invitation that the request waits for the person to join', async () => {
    withTrade(tradeView({ yourRole: 'BUYER', status: 'PENDING_COUNTERPARTY', awaiting: null }));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByRole('heading', { name: 'Invitation waiting' })).toBeTruthy();
    expect(screen.getByText(/They're not on Komtru yet/)).toBeTruthy();
    expect(screen.queryByText(/Send them/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Withdraw the invitation' })).toBeTruthy();
  });

  const invited = () =>
    tradeView({ yourRole: 'SELLER', initiatorRole: 'BUYER', status: 'PENDING_COUNTERPARTY', awaiting: null });

  it('lets an invited person take their place once they have an address', async () => {
    withTrade(invited(), {
      'POST /trades/:id/claim': tradeView({ status: 'AWAITING_ACCEPTANCE', awaiting: 'YOU' }),
    });
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    const claim = await screen.findByRole<HTMLButtonElement>('button', { name: 'Take your place' });
    await waitFor(() => {
      expect(claim.disabled).toBe(false);
    });
    fireEvent.click(claim);
    expect(await screen.findByRole('button', { name: 'Accept trade request' })).toBeTruthy();
  });

  it('gives a new invitee, who has no address, the way to add one before they can claim', async () => {
    let list = page<unknown>([]);
    withTrade(invited(), {
      'GET /me/addresses': () => list,
      'GET /geo/states': page([{ id: id(70), code: 'LA', name: 'Lagos' }]),
      'GET /geo/states/:stateId/cities': page([{ id: id(71), stateId: id(70), name: 'Ikeja', active: true }]),
      'POST /me/addresses': () => {
        const saved = address(5, { label: 'Shop', isDefault: true });
        list = page([saved]);
        return saved;
      },
      'POST /trades/:id/claim': tradeView({ status: 'AWAITING_ACCEPTANCE', awaiting: 'YOU' }),
    });
    renderWithApi(api.call, <TradeScreen id={id(1)} />);

    // The add-address form is on the screen, and claiming waits for an address.
    const claim = await screen.findByRole<HTMLButtonElement>('button', { name: 'Take your place' });
    expect(claim.disabled).toBe(true);
    fireEvent.change(await screen.findByLabelText('Name for this address'), { target: { value: 'Shop' } });
    fireEvent.change(screen.getByLabelText('Recipient name'), { target: { value: 'Ada Obi' } });
    fireEvent.change(screen.getByLabelText('Recipient phone'), { target: { value: '08012345678' } });
    fireEvent.change(screen.getByLabelText('Street address'), { target: { value: '12 Allen Avenue' } });
    await screen.findByRole('option', { name: 'Lagos' });
    fireEvent.change(screen.getByLabelText('State'), { target: { value: id(70) } });
    await screen.findByRole('option', { name: 'Ikeja' });
    fireEvent.change(screen.getByLabelText('City'), { target: { value: id(71) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('radio', { name: /Shop/ }).checked).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Take your place' }).disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Take your place' }));
    expect(await screen.findByRole('button', { name: 'Accept trade request' })).toBeTruthy();
    expect(callsTo(api.call, 'POST', '/trades/:id/claim')).toHaveLength(1);
  });

  it('says why when the claim is still refused, and leaves the picker there to fix it', async () => {
    withTrade(invited(), { 'POST /trades/:id/claim': problem('ADDRESS_REQUIRED', 422) });
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    const claim = await screen.findByRole<HTMLButtonElement>('button', { name: 'Take your place' });
    await waitFor(() => {
      expect(claim.disabled).toBe(false);
    });
    fireEvent.click(claim);
    expect(await screen.findByText('Choose or add a saved address first.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Home/ })).toBeTruthy();
  });
});

describe('a stale accept', () => {
  it('loads the latest terms and says they changed, so the next accept is of what is on screen', async () => {
    let reads = 0;
    withTrade(
      () => {
        reads += 1;
        return tradeView(
          reads === 1
            ? {}
            : {
                terms: {
                  ...tradeView().terms,
                  versionId: id(41),
                  versionNumber: 2,
                  itemAmountMinor: '49500000',
                },
              },
        );
      },
      {
        'POST /trades/:id/accept': problem('CONFLICT', 409, 'The other party changed the terms.'),
        'POST /files/upload-url': () => {
          uploads += 1;
          return {
            fileId: id(89 + uploads),
            cloudName: 'k',
            uploadUrl: 'https://upload.test/x',
            params: {},
            maxBytes: 9_999_999,
            expiresAt: 'x',
          };
        },
        'POST /files/:id/finalize': ({ params }: { params?: Record<string, string> }) => ({
          fileId: params?.id,
          uploadState: 'PENDING',
        }),
      },
    );
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
      target: {
        files: [
          new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
          new File(['x'], 'b.jpg', { type: 'image/jpeg' }),
        ],
      },
    });
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Accept trade request' }).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole('button', { name: 'Accept trade request' }));

    expect(await screen.findByText(/The terms changed while you were looking/)).toBeTruthy();
    // The screen now shows the version the platform holds, not the one that was refused.
    expect((await screen.findAllByText('₦495,000.00')).length).toBeGreaterThan(0);
    expect(reads).toBeGreaterThanOrEqual(2);
    vi.unstubAllGlobals();
  });
});

describe('held for review (G3) and not sent (IF1)', () => {
  it('says the proposal is held, that it is not a judgment, and keeps the Trade Code', async () => {
    withTrade(
      tradeView({
        yourRole: 'BUYER',
        status: 'UNDER_PROPOSAL_REVIEW',
        awaiting: null,
        tradeCode: 'KMT-9013800-NG',
      }),
    );
    const { container } = renderWithApi(api.call, <TradeScreen id={id(1)} />);
    expect(await screen.findByRole('heading', { name: 'Held for review' })).toBeTruthy();
    expect(screen.getByText(/This isn't a judgment about you/)).toBeTruthy();
    expect(screen.getByText('KMT-9013800-NG')).toBeTruthy();
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

  it('has one h1: the header, with the hero a level below it', async () => {
    withTrade(tradeView({ yourRole: 'BUYER', status: 'REJECTED', awaiting: null }));
    renderWithApi(api.call, <TradeScreen id={id(1)} />);
    await screen.findByRole('heading', { name: "This proposal can't go ahead" });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
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
      'Version 1',
      'Version 2',
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
    expect(await screen.findByRole('heading', { name: 'KMT-9042800-NG' })).toBeTruthy();
    expect(screen.getByLabelText('Terms of this trade')).toBeTruthy();
  });
});
