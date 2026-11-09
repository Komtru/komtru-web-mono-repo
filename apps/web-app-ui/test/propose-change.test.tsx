// @vitest-environment jsdom
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
    expect((await screen.findByLabelText<HTMLInputElement>('Item price')).value).toBe('452,000');
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

  it('shows the revised terms summary and the note that the old proposal is not the agreement', async () => {
    answerWith(api.call, handlers());
    renderWithApi(api.call, <ProposeChange id={id(1)} />);
    fireEvent.change(await screen.findByLabelText('Item price'), { target: { value: '495,000' } });
    const summary = screen.getByLabelText('Revised terms summary');
    expect(within(summary).getByText('Item price').nextElementSibling?.textContent).toBe('₦495,000.00');
    expect(within(summary).getByText('Other terms').nextElementSibling?.textContent).toBe('Unchanged');
    expect(screen.getByText('The previous proposal is not the accepted agreement.')).toBeTruthy();
  });

  it('writes both sides of an address change in the same form: street, then landmark', async () => {
    const ownSide = { street: '5 Adeola Odeku', landmark: 'Victoria Island' };
    answerWith(
      api.call,
      handlers({
        'GET /trades/:id': tradeView({
          yourRole: 'BUYER',
          initiatorRole: 'SELLER',
          terms: { ...tradeView().terms, deliveryAddress: ownSide },
        }),
        'GET /me/addresses': page([
          address(1),
          address(2, { streetLine: '3 Broad Street', landmark: 'By the bank' }),
        ]),
      }),
    );
    renderWithApi(api.call, <ProposeChange id={id(1)} />);
    fireEvent.click(await screen.findByLabelText(/Use a different/));
    fireEvent.click(await screen.findByRole('radio', { name: /Address 2/ }));
    expect(screen.getByText(/Was:/).parentElement?.textContent).toBe('Was: 5 Adeola Odeku, Victoria Island');
    expect(screen.getByText(/Now:/).parentElement?.textContent).toContain('3 Broad Street, By the bank');
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

  it('recovers from a stale counter: loads the latest terms and sends the new revision next time', async () => {
    let reads = 0;
    let sends = 0;
    answerWith(
      api.call,
      handlers({
        'GET /trades/:id': () => {
          reads += 1;
          // The other party changed the price meanwhile; the revision moved on with it.
          return reads === 1
            ? tradeView()
            : tradeView({ statusRevision: 3, terms: { ...tradeView().terms, itemAmountMinor: '47000000' } });
        },
        'POST /trades/:id/counter': ({ body }: { body?: unknown }) => {
          sends += 1;
          if (sends === 1) {
            return new ProblemError(
              { type: 'about:blank', title: 't', status: 409, code: 'CONFLICT' },
              {
                status: 409,
                requestId: undefined,
                replayed: false,
                retryAfterMs: undefined,
                rateLimit: undefined,
              },
              false,
            );
          }
          return { sent: body };
        },
      }),
    );
    renderWithApi(api.call, <ProposeChange id={id(1)} />);
    fireEvent.change(await screen.findByLabelText('Item price'), { target: { value: '500,000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send counter-proposal' }));

    expect(await screen.findByText(/The terms changed while you were looking/)).toBeTruthy();
    // The edit made against the old terms is dropped and the form shows what the platform now holds.
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('Item price').value).toBe('470,000');
    });

    fireEvent.change(screen.getByLabelText('Item price'), { target: { value: '480,000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send counter-proposal' }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalled();
    });
    const sent = callsTo(api.call, 'POST', '/trades/:id/counter').map((call) => call.body);
    expect(sent[0]).toMatchObject({ expectedRevision: 2 });
    expect(sent[1]).toMatchObject({ expectedRevision: 3, itemAmountMinor: '48000000' });
  });

  it('shows the shape of the page while the trade loads, and a retry when it cannot be read', async () => {
    api.call.mockImplementation(() => new Promise(() => undefined));
    const first = renderWithApi(api.call, <ProposeChange id={id(1)} />);
    expect(screen.getByRole('status', { name: 'Loading the trade' })).toBeTruthy();
    first.unmount();

    answerWith(api.call, handlers({ 'GET /trades/:id': new Error('offline') }));
    renderWithApi(api.call, <ProposeChange id={id(1)} />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it("does not offer a change when it is not the person's turn", async () => {
    answerWith(api.call, handlers({ 'GET /trades/:id': tradeView({ awaiting: 'COUNTERPARTY' }) }));
    renderWithApi(api.call, <ProposeChange id={id(1)} />);
    expect(await screen.findByText(/It isn't your turn on this trade/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send counter-proposal' })).toBeNull();
  });
});
