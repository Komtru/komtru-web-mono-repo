// @vitest-environment jsdom
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProposeChange } from '../src/trade/ProposeChange';
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

beforeEach(() => {
  api.call.mockReset();
  router.push.mockReset();
});
afterEach(cleanup);

const handlers = (over: Record<string, unknown> = {}) => ({
  'GET /trades/:id': tradeView(),
  'GET /me/addresses': page([address(1), address(2, { streetLine: '3 Broad Street' })]),
  'POST /trades/:id/counter': tradeView({ awaiting: 'COUNTERPARTY' }),
  ...over,
});

describe('Propose a Change (TC-05)', () => {
  it('starts from the current terms and shows nothing as changing until something is', async () => {
    answerWith(api.call, handlers());
    const { container } = renderWithApi(api.call, <ProposeChange id={id(1)} />);
    expect((await screen.findByLabelText<HTMLInputElement>('Item price')).value).toBe('452000');
    expect(screen.getByText(/Nothing yet/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send counter-proposal' }).disabled).toBe(
      true,
    );
    expect(screen.getByRole('link', { name: 'Discard changes' }).getAttribute('href')).toBe(
      `/trade/${id(1)}`,
    );
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('shows a changed price as the old one struck through above the new, and sends only that', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <ProposeChange id={id(1)} />);
    fireEvent.change(await screen.findByLabelText('Item price'), { target: { value: '495,000' } });

    expect(screen.getByText(/Was:/).parentElement?.textContent).toBe('Was: ₦452,000.00 — buyer proposed');
    expect(screen.getByText(/Now:/).parentElement?.textContent).toBe('Now: ₦495,000.00 — your counter');

    fireEvent.click(screen.getByRole('button', { name: 'Send counter-proposal' }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/trade/${id(1)}`);
    });
    // The revision the person was looking at travels with it, so a stale counter fails instead of landing.
    expect(callsTo(api.call, 'POST', '/trades/:id/counter')[0]?.body).toEqual({
      expectedRevision: 2,
      itemAmountMinor: '49500000',
    });
  });

  it('changes the address too, when asked', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <ProposeChange id={id(1)} />);
    fireEvent.click(await screen.findByLabelText(/Use a different/));
    fireEvent.click(await screen.findByRole('radio', { name: /Address 2/ }));
    expect(screen.getAllByText(/3 Broad Street/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Send counter-proposal' }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalled();
    });
    expect(callsTo(api.call, 'POST', '/trades/:id/counter')[0]?.body).toEqual({
      expectedRevision: 2,
      addressId: id(2),
    });
  });

  it('refuses an amount that is not a price', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <ProposeChange id={id(1)} />);
    fireEvent.change(await screen.findByLabelText('Item price'), { target: { value: 'lots' } });
    expect(screen.getByText('Enter the price in naira, for example 452,000')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send counter-proposal' }).disabled).toBe(
      true,
    );
  });

  it('says so when the trade moved on while the person was editing', async () => {
    answerWith(
      api.call,
      handlers({
        'POST /trades/:id/counter': new ProblemError(
          { type: 'about:blank', title: 't', status: 409, code: 'INVALID_TRANSITION' },
          {
            status: 409,
            requestId: undefined,
            replayed: false,
            retryAfterMs: undefined,
            rateLimit: undefined,
          },
          false,
        ),
      }),
    );
    renderWithApi(api.call, <ProposeChange id={id(1)} />);
    fireEvent.change(await screen.findByLabelText('Item price'), { target: { value: '500,000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send counter-proposal' }));
    expect(await screen.findByText(/This trade has moved on since you opened it/)).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("does not offer a change when it is not the person's turn", async () => {
    answerWith(api.call, handlers({ 'GET /trades/:id': tradeView({ awaiting: 'COUNTERPARTY' }) }));
    renderWithApi(api.call, <ProposeChange id={id(1)} />);
    expect(await screen.findByText(/It isn't your turn on this trade/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send counter-proposal' })).toBeNull();
  });
});
