// @vitest-environment jsdom
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FindTrade } from '../src/home/FindTrade';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  answerWith,
  callsTo,
  counterparty,
  id,
  renderWithApi,
  type CallFn,
} from './support/trade';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const problem = (status: number, code: string) =>
  new ProblemError(
    { type: 'about:blank', title: 'Reworded by the platform', status, code },
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
  counterparty: counterparty({ displayName: 'TechEdge NG', username: 'techedge' }),
  ...over,
});

function fill(value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: "Enter the seller's Trade Code" }), {
    target: { value },
  });
}
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Find Trade' }));

describe('Find a Trade by code (F1)', () => {
  it('tells the person what a Trade Code looks like, without calling the platform, when the code is not one', () => {
    answerWith(api.call, { 'GET /trades/by-code/:code': lookup('PARTY') });
    renderWithApi(api.call, <FindTrade />);
    fill('hello');
    submit();
    expect(screen.getByText("That isn't a Trade Code. A Trade Code looks like KMT-7398512-NG.")).toBeTruthy();
    expect(
      screen.getByRole('textbox', { name: "Enter the seller's Trade Code" }).getAttribute('aria-invalid'),
    ).toBe('true');
    expect(callsTo(api.call, 'GET', '/trades/by-code/:code')).toHaveLength(0);
  });

  it('asks for the canonical code once, however it was typed', async () => {
    answerWith(api.call, { 'GET /trades/by-code/:code': lookup('PARTY') });
    renderWithApi(api.call, <FindTrade />);
    fill(' kmt-9042800 ');
    submit();
    await screen.findByRole('link', { name: 'Open trade' });
    expect(callsTo(api.call, 'GET', '/trades/by-code/:code').map((call) => call.params)).toEqual([
      { code: 'KMT-9042800-NG' },
    ]);
  });

  it('opens a code from the address without the person typing it', async () => {
    answerWith(api.call, { 'GET /trades/by-code/:code': lookup('PARTY') });
    renderWithApi(api.call, <FindTrade initialCode="KMT-9042800" />);
    expect(await screen.findByRole('link', { name: 'Open trade' })).toBeTruthy();
    expect(
      (screen.getByRole('textbox', { name: "Enter the seller's Trade Code" }) as HTMLInputElement).value,
    ).toBe('KMT-9042800');
  });
});

describe('a code the person is a party to (F2)', () => {
  beforeEach(() => {
    answerWith(api.call, { 'GET /trades/by-code/:code': lookup('PARTY') });
  });

  it('shows the trade as verified inside Komtru, with its code, the other party and its status', async () => {
    const { container } = renderWithApi(api.call, <FindTrade />);
    fill('KMT-9042800');
    submit();

    const found = await screen.findByRole('region', { name: 'Trade found' });
    expect(within(found).getByText('Verified Trade — found on Komtru')).toBeTruthy();
    expect(within(found).getByText('KMT-9042800-NG')).toBeTruthy();
    expect(within(found).getByText('TechEdge NG')).toBeTruthy();
    expect(within(found).getByText('Sent')).toBeTruthy();
    expect(within(found).getByText('Category: Electronics')).toBeTruthy();
    expect(within(found).getByRole('link', { name: 'Open trade' }).getAttribute('href')).toBe(
      `/trade/${id(1)}`,
    );
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});

describe('a code for a trade the person was invited to', () => {
  it('says who invited them and sends them to the claim screen, without showing the terms', async () => {
    answerWith(api.call, { 'GET /trades/by-code/:code': lookup('INVITEE') });
    renderWithApi(api.call, <FindTrade />);
    fill('KMT-9042800');
    submit();

    const invited = await screen.findByRole('region', { name: 'Trade invitation' });
    expect(within(invited).getByText(/TechEdge NG has invited you to a trade in Electronics/)).toBeTruthy();
    expect(within(invited).getByRole('link', { name: 'Review the invitation' }).getAttribute('href')).toBe(
      '/trades/KMT-9042800-NG',
    );
    expect(screen.queryByRole('link', { name: 'Open trade' })).toBeNull();
  });
});

describe('a code that does not lead to a trade for this person', () => {
  it('says no trade was found for them, with no retry, when the platform answers not found', async () => {
    answerWith(api.call, { 'GET /trades/by-code/:code': problem(404, 'NOT_FOUND') });
    renderWithApi(api.call, <FindTrade />);
    fill('KMT-9042800');
    submit();

    expect(await screen.findByRole('heading', { name: 'No trade found for you' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByText(/not found|forbidden/i)).toBeNull();
    expect(callsTo(api.call, 'GET', '/trades/by-code/:code')).toHaveLength(1);
  });

  it("tells the person they have tried too often, in the platform's words, with no retry", async () => {
    answerWith(api.call, { 'GET /trades/by-code/:code': problem(429, 'RATE_LIMITED') });
    renderWithApi(api.call, <FindTrade />);
    fill('KMT-9042800');
    submit();

    expect(await screen.findByRole('heading', { name: 'Too many tries' })).toBeTruthy();
    expect(screen.getByText('Too many tries. Wait a minute and try again.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('offers a retry when the lookup fails for another reason, and does not repeat it on its own', async () => {
    let calls = 0;
    answerWith(api.call, {
      'GET /trades/by-code/:code': () => {
        calls += 1;
        return calls === 1 ? new Error('offline') : lookup('PARTY');
      },
    });
    renderWithApi(api.call, <FindTrade />);
    fill('KMT-9042800');
    submit();

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Open trade' })).toBeTruthy();
    await waitFor(() => expect(calls).toBe(2));
  });
});
