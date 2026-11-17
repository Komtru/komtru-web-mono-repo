// @vitest-environment jsdom
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TradeByCode } from '../src/trade/TradeByCode';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  address,
  answerWith,
  callsTo,
  counterparty,
  id,
  page,
  renderWithApi,
  tradeView,
  type CallFn,
} from './support/trade';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
  router.push.mockReset();
  router.replace.mockReset();
});
afterEach(cleanup);

const problem = (status: number, code: string) =>
  new ProblemError(
    { type: 'about:blank', title: 'Reworded', status, code },
    { status, requestId: undefined, replayed: false, retryAfterMs: undefined, rateLimit: undefined },
    false,
  );

const lookup = (access: 'PARTY' | 'INVITEE', over: Record<string, unknown> = {}) => ({
  access,
  trade: {
    id: id(1),
    tradeCode: 'KMT-9042800-NG',
    status: access === 'PARTY' ? 'AWAITING_ACCEPTANCE' : 'PENDING_COUNTERPARTY',
    statusRevision: 1,
    yourRole: 'SELLER',
    categoryCode: 'electronics',
    categoryName: 'Electronics',
    standardVersion: 1,
    standardVersionId: id(60),
  },
  counterparty: counterparty(),
  ...over,
});

describe('opening a trade from its code', () => {
  it('asks for the canonical code even when it was typed lowercase and without the market suffix', async () => {
    answerWith(api.call, { 'GET /trades/by-code/:code': lookup('PARTY') });
    renderWithApi(api.call, <TradeByCode typed=" kmt-9042800 " />);
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalled();
    });
    expect(callsTo(api.call, 'GET', '/trades/by-code/:code')[0]?.params).toEqual({ code: 'KMT-9042800-NG' });
  });

  it('goes straight to the trade for a party', async () => {
    answerWith(api.call, { 'GET /trades/by-code/:code': lookup('PARTY') });
    renderWithApi(api.call, <TradeByCode typed="KMT-9042800-NG" />);
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/trade/${id(1)}`);
    });
  });

  it('does not call the platform for something that is not a code, and says what a code looks like', () => {
    answerWith(api.call, {});
    renderWithApi(api.call, <TradeByCode typed="not a code" />);
    expect(screen.getByText("That isn't a Trade Code")).toBeTruthy();
    expect(screen.getByText(/KMT-7398512-NG/)).toBeTruthy();
    expect(api.call).not.toHaveBeenCalled();
  });

  it('says "We can’t find that Trade" (SP-M19) for a 404, with no retry, and implies nothing about whether it exists', async () => {
    answerWith(api.call, { 'GET /trades/by-code/:code': problem(404, 'NOT_FOUND'), 'GET /me': { id: 'x' } });
    const { container } = renderWithApi(api.call, <TradeByCode typed="KMT-9042800-NG" />);
    expect(await screen.findByText('We can’t find that Trade')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(container.textContent).not.toMatch(/forbidden|not yours|exists|permission/i);
    expect(callsTo(api.call, 'GET', '/trades/by-code/:code')).toHaveLength(1);
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('does not retry on its own, and offers no retry when it is rate-limited', async () => {
    answerWith(api.call, { 'GET /trades/by-code/:code': problem(429, 'RATE_LIMITED') });
    renderWithApi(api.call, <TradeByCode typed="KMT-9042800-NG" />);
    expect(await screen.findByText('Too many tries. Wait a minute and try again.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(callsTo(api.call, 'GET', '/trades/by-code/:code')).toHaveLength(1);
  });

  it('offers a retry for a failure that is not a miss', async () => {
    answerWith(api.call, { 'GET /trades/by-code/:code': new Error('offline') });
    renderWithApi(api.call, <TradeByCode typed="KMT-9042800-NG" />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('shows the shape of the page while it looks', () => {
    api.call.mockImplementation(() => new Promise(() => undefined));
    renderWithApi(api.call, <TradeByCode typed="KMT-9042800-NG" />);
    expect(screen.getByRole('status', { name: 'Opening the trade' })).toBeTruthy();
  });
});

describe('the invitee preview', () => {
  it('previews who invited them, with no price, terms or address, and says what got them here', async () => {
    answerWith(api.call, {
      'GET /trades/by-code/:code': lookup('INVITEE'),
      'GET /me/addresses': page([address(1)]),
    });
    const { container } = renderWithApi(api.call, <TradeByCode typed="KMT-9042800-NG" />);
    expect(await screen.findByText(/Amaka B\. has invited you to a trade in Electronics/)).toBeTruthy();
    expect(
      screen.getByText(/signed up with the phone number or email the invitation was sent to/),
    ).toBeTruthy();
    expect(screen.getByText(/a link or a code on its own doesn't open anyone's trade/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/₦/);
    expect(screen.getByText('KMT-9042800-NG')).toBeTruthy();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('takes their place with a saved address and goes to the trade', async () => {
    answerWith(api.call, {
      'GET /trades/by-code/:code': lookup('INVITEE'),
      'GET /me/addresses': page([address(1)]),
      'POST /trades/:id/claim': tradeView({ status: 'AWAITING_ACCEPTANCE', awaiting: 'YOU' }),
    });
    renderWithApi(api.call, <TradeByCode typed="KMT-9042800-NG" />);
    const claim = await screen.findByRole<HTMLButtonElement>('button', { name: 'Take your place' });
    await waitFor(() => {
      expect(claim.disabled).toBe(false);
    });
    fireEvent.click(claim);
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/trade/${id(1)}`);
    });
    expect(callsTo(api.call, 'POST', '/trades/:id/claim')[0]?.params).toEqual({ id: id(1) });
  });

  it('gives an invitee with no address the way to add one, then lets them claim', async () => {
    let list = page<unknown>([]);
    answerWith(api.call, {
      'GET /trades/by-code/:code': lookup('INVITEE'),
      'GET /me/addresses': () => list,
      'GET /geo/states': page([{ id: id(70), code: 'LA', name: 'Lagos' }]),
      'GET /geo/states/:stateId/cities': page([{ id: id(71), stateId: id(70), name: 'Ikeja', active: true }]),
      'POST /me/addresses': () => {
        const saved = address(5, { label: 'Shop', isDefault: true });
        list = page([saved]);
        return saved;
      },
      'POST /trades/:id/claim': problem(422, 'ADDRESS_REQUIRED'),
    });
    renderWithApi(api.call, <TradeByCode typed="KMT-9042800-NG" />);
    expect((await screen.findByRole<HTMLButtonElement>('button', { name: 'Take your place' })).disabled).toBe(
      true,
    );
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
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Take your place' }).disabled).toBe(false);
    });
  });

  it('copes with an inviter the platform has no display for', async () => {
    answerWith(api.call, {
      'GET /trades/by-code/:code': lookup('INVITEE', { counterparty: null }),
      'GET /me/addresses': page([address(1)]),
    });
    renderWithApi(api.call, <TradeByCode typed="KMT-9042800-NG" />);
    expect(await screen.findByText(/Someone has invited you to a trade in Electronics/)).toBeTruthy();
  });
});
