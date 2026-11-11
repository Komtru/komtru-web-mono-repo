// @vitest-environment jsdom
// F-027: confirming delivery (Customer-4, AB1), and the delivery deadline's three faces: the seller asking for
// more time (DE1), the buyer answering (DE2) and the date passing (DE3).
import { ProblemError } from '@komtru/api-client';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestMoreTime } from '../src/trade/shipping/RequestMoreTime';
import { TradeScreen } from '../src/trade/TradeScreen';
import { expectNoAxeViolations } from './axe';
import {
  SHELL_RULES,
  activityRow,
  answerWith,
  callsTo,
  deliveryDeadline,
  id,
  inspectionRead,
  page,
  renderWithApi,
  workspaceTrade,
  type CallFn,
} from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const problem = (code: string, status: number, detail?: string) =>
  new ProblemError(
    { type: 'about:blank', title: 'Reworded', status, code, ...(detail ? { detail } : {}) },
    { status, requestId: undefined, replayed: false, retryAfterMs: undefined, rateLimit: undefined },
    false,
  );

const FUTURE = new Date(Date.now() + 36 * 3_600_000).toISOString();
const PAST = new Date(Date.now() - 24 * 3_600_000).toISOString();
const request = (status = 'PENDING') => ({
  id: id(96),
  status,
  reason: 'COURIER_PICKUP_DELAYED',
  note: 'The courier moved my pickup',
  currentDueAt: FUTURE,
  requestedDueAt: new Date(Date.now() + 72 * 3_600_000).toISOString(),
});
const deadline = (dueAt: string, over: Record<string, unknown> = {}) => ({
  ...deliveryDeadline(dueAt),
  ...over,
});

const serve = (trade: unknown, more: Record<string, unknown> = {}) =>
  answerWith(api.call, {
    'GET /trades/:id': trade,
    'GET /trades/:id/delivery-deadline': deadline(FUTURE),
    'GET /trades/:id/inspection': inspectionRead(),
    'GET /trades/:id/activity': page([activityRow(1)]),
    'GET /trades': page([]),
    ...more,
  });

const overview = () => renderWithApi(api.call, <TradeScreen id={id(1)} tab="overview" />);

describe('confirm delivery (Customer-4, AB1)', () => {
  it.each([
    ['SHIPPED', 'Confirm you have it'],
    ['UNCONFIRMED_DELIVERY', 'Confirm delivery'],
  ] as const)('lets the buyer say they have it on %s, and says what that starts', async (status, label) => {
    serve(workspaceTrade(status, 'BUYER'), {
      'POST /trades/:id/confirm-delivery': workspaceTrade('INSPECTION', 'BUYER'),
    });
    const { container } = overview();
    fireEvent.click(await screen.findByRole('button', { name: label }));
    await waitFor(() => {
      expect(callsTo(api.call, 'POST', '/trades/:id/confirm-delivery')).toHaveLength(1);
    });
    expect(callsTo(api.call, 'POST', '/trades/:id/confirm-delivery')[0]).toMatchObject({
      params: { id: id(1) },
    });
    // The trade the platform answered with is now the one drawn: inspection, with the way into Z4.
    expect(await screen.findByText('Inspect the item')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Inspect & confirm' })).toBeTruthy();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says it starts the inspection time, and that this is for once the item is in hand', async () => {
    serve(workspaceTrade('SHIPPED', 'BUYER'));
    overview();
    expect(await screen.findByText(/Confirm only once the item is in your hands/)).toBeTruthy();
    expect(screen.getByText(/48 hours of inspection time starts when you do/)).toBeTruthy();
  });

  it('shows the platform’s words if it refuses, and the button is usable again', async () => {
    serve(workspaceTrade('SHIPPED', 'BUYER'), {
      'POST /trades/:id/confirm-delivery': problem('INVALID_TRANSITION', 409),
    });
    overview();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm you have it' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Confirm you have it' }).disabled).toBe(
      false,
    );
  });

  it('sends the confirmation once however many times it is pressed', async () => {
    serve(workspaceTrade('SHIPPED', 'BUYER'), {
      'POST /trades/:id/confirm-delivery': workspaceTrade('INSPECTION', 'BUYER'),
    });
    overview();
    const button = await screen.findByRole('button', { name: 'Confirm you have it' });
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByText('Inspect the item');
    expect(callsTo(api.call, 'POST', '/trades/:id/confirm-delivery')).toHaveLength(1);
  });

  it('reads the trade again when the platform answers with a conflict, so the screen follows it', async () => {
    serve(workspaceTrade('SHIPPED', 'BUYER'), {
      'POST /trades/:id/confirm-delivery': problem('INVALID_TRANSITION', 409),
    });
    overview();
    await screen.findByRole('button', { name: 'Confirm you have it' });
    const before = callsTo(api.call, 'GET', '/trades/:id').length;
    fireEvent.click(screen.getByRole('button', { name: 'Confirm you have it' }));
    await screen.findByRole('alert');
    await waitFor(() => {
      expect(callsTo(api.call, 'GET', '/trades/:id').length).toBeGreaterThan(before);
    });
  });

  it('gives the seller nothing to confirm', async () => {
    serve(workspaceTrade('SHIPPED', 'SELLER'));
    overview();
    await screen.findByText('The item is on its way');
    expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull();
  });

  it('shows the vehicle on the live logistics card when the platform recorded it', async () => {
    serve(workspaceTrade('SHIPPED', 'BUYER'));
    overview();
    const card = await screen.findByLabelText('Shipment');
    expect(within(card).getByText('LSR123AB')).toBeTruthy();
    expect(within(card).getByText('KT-883192')).toBeTruthy();
    // Self-arranged only for the MVP: no hub, no pickup PIN.
    expect(screen.queryByText(/pickup pin|park hub/i)).toBeNull();
  });
});

describe('DE2: the buyer answers the seller’s request for more time', () => {
  const asked = () =>
    serve(workspaceTrade('FUNDED', 'BUYER'), {
      'GET /trades/:id/delivery-deadline': deadline(FUTURE, { extensionRequest: request() }),
    });

  it('shows the reason, both dates, and that accepting only moves the date', async () => {
    asked();
    const { container } = overview();
    const rows = await screen.findByLabelText('Request for more time');
    expect(within(rows).getByText('Courier pickup delayed')).toBeTruthy();
    expect(within(rows).getByText('Original date')).toBeTruthy();
    expect(within(rows).getByText('Requested date')).toBeTruthy();
    expect(within(rows).getByText('The courier moved my pickup')).toBeTruthy();
    expect(screen.getByText(/only moves the delivery date/)).toBeTruthy();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it.each([
    ['Accept new date', 'accept'],
    ['Decline', 'decline'],
  ] as const)('%s calls the %s route for that request', async (name, route) => {
    serve(workspaceTrade('FUNDED', 'BUYER'), {
      'GET /trades/:id/delivery-deadline': deadline(FUTURE, { extensionRequest: request() }),
      [`POST /trades/:id/delivery-extension/:requestId/${route}`]: { id: id(96), status: 'ACCEPTED' },
    });
    overview();
    fireEvent.click(await screen.findByRole('button', { name }));
    await waitFor(() => {
      expect(callsTo(api.call, 'POST', `/trades/:id/delivery-extension/:requestId/${route}`)).toHaveLength(1);
    });
    expect(callsTo(api.call, 'POST', `/trades/:id/delivery-extension/:requestId/${route}`)[0]).toMatchObject({
      params: { id: id(1), requestId: id(96) },
    });
  });

  it('tells the seller they are waiting, with nothing to press', async () => {
    serve(workspaceTrade('FUNDED', 'SELLER'), {
      'GET /trades/:id/delivery-deadline': deadline(FUTURE, { extensionRequest: request() }),
    });
    overview();
    expect(await screen.findByText('Waiting for the buyer')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /ask the buyer for more time/i })).toBeNull();
  });
});

describe('DE3: the date has passed', () => {
  it('tells the buyer, says the money stays protected, and offers no refund button (the platform refunds on its own)', async () => {
    serve(workspaceTrade('FUNDED', 'BUYER'), { 'GET /trades/:id/delivery-deadline': deadline(PAST) });
    overview();
    expect(await screen.findByText('Delivery is overdue')).toBeTruthy();
    expect(screen.getByText(/stays protected/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /refund/i })).toBeNull();
  });

  it('tells the seller and stops offering to ask for more time', async () => {
    serve(workspaceTrade('FUNDED', 'SELLER'), { 'GET /trades/:id/delivery-deadline': deadline(PAST) });
    overview();
    expect(await screen.findByText('Your delivery date has passed')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /ask the buyer for more time/i })).toBeNull();
  });

  it('draws nothing of it when the platform reports no open deadline', async () => {
    serve(workspaceTrade('FUNDED', 'BUYER'), {
      'GET /trades/:id/delivery-deadline': { deadline: null, extensionRequest: null },
    });
    overview();
    await screen.findByText('Your funds are protected');
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });
});

describe('DE1: the seller asks the buyer for more time', () => {
  const show = () => renderWithApi(api.call, <RequestMoreTime id={id(1)} />);

  it('is offered on the paid overview while the seller may still ask', async () => {
    serve(workspaceTrade('FUNDED', 'SELLER'));
    overview();
    expect(
      (await screen.findByRole('link', { name: 'Ask the buyer for more time' })).getAttribute('href'),
    ).toBe(`/trade/${id(1)}/extend`);
  });

  it('keeps Send shut until a reason and a later date are given, then sends the instant and the reason', async () => {
    serve(workspaceTrade('FUNDED', 'SELLER'), {
      'POST /trades/:id/delivery-extension': { id: id(96), status: 'PENDING' },
    });
    const { container } = show();
    const send = await screen.findByRole<HTMLButtonElement>('button', { name: 'Send extension request' });
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Restocking the exact item' }));
    const date = screen.getByLabelText('New delivery date and time');
    fireEvent.change(date, { target: { value: '2020-01-01T10:00' } });
    fireEvent.blur(date);
    expect(await screen.findByText(/Choose a date later than/)).toBeTruthy();
    expect(send.disabled).toBe(true);
    const later = new Date(Date.now() + 60 * 3_600_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const local = `${String(later.getFullYear())}-${pad(later.getMonth() + 1)}-${pad(later.getDate())}T${pad(later.getHours())}:${pad(later.getMinutes())}`;
    fireEvent.change(date, { target: { value: local } });
    await waitFor(() => {
      expect(send.disabled).toBe(false);
    });
    fireEvent.change(screen.getByLabelText(/Note to buyer/), { target: { value: 'Back in stock Friday' } });
    fireEvent.click(send);
    expect(await screen.findByText('Request sent')).toBeTruthy();
    const call = callsTo(api.call, 'POST', '/trades/:id/delivery-extension')[0];
    expect(call).toMatchObject({
      params: { id: id(1) },
      body: { reason: 'RESTOCKING_ITEM', note: 'Back in stock Friday' },
    });
    expect((call?.body as { requestedDueAt: string }).requestedDueAt).toBe(new Date(local).toISOString());
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('shows the platform’s refusal in its own words (the cap is its rule, not ours)', async () => {
    serve(workspaceTrade('FUNDED', 'SELLER'), {
      'POST /trades/:id/delivery-extension': problem(
        'VALIDATION_FAILED',
        422,
        'The new date is more than one delivery window away.',
      ),
    });
    show();
    fireEvent.click(await screen.findByRole('radio', { name: 'Courier pickup delayed' }));
    fireEvent.change(screen.getByLabelText('New delivery date and time'), {
      target: { value: '2099-01-01T10:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send extension request' }));
    expect(await screen.findByText('The new date is more than one delivery window away.')).toBeTruthy();
  });

  it.each([
    ['the buyer', workspaceTrade('FUNDED', 'BUYER'), deadline(FUTURE), /Only the seller can ask/],
    [
      'asked already',
      workspaceTrade('FUNDED', 'SELLER'),
      deadline(FUTURE, {
        deadline: { id: id(90), status: 'PENDING', dueAt: FUTURE, originalDueAt: FUTURE, extensionCount: 1 },
      }),
      /only be asked for once/,
    ],
    ['overdue', workspaceTrade('FUNDED', 'SELLER'), deadline(PAST), /can’t be moved now/],
    [
      'pending',
      workspaceTrade('FUNDED', 'SELLER'),
      deadline(FUTURE, { extensionRequest: request() }),
      /already asked/,
    ],
  ] as const)('offers no form to %s', async (_who, trade, read, words) => {
    serve(trade, { 'GET /trades/:id/delivery-deadline': read });
    show();
    expect(await screen.findByText(words)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send extension request' })).toBeNull();
  });
});
