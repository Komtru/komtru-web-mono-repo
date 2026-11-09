// @vitest-environment jsdom
// The screens kept current by the trade's room: what a person sees after a push, after a reconnect, and when
// the room is refused. The hook's own rules are proven in `packages/api-client`; this proves they reach the
// screens, through the real realtime provider and a socket that behaves as socket.io-client does.
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyTrades } from '../src/trade/MyTrades';
import { TradeScreen } from '../src/trade/TradeScreen';
import {
  activityRow,
  answerWith,
  callsTo,
  deliveryDeadline,
  fakeSocket,
  id,
  inspectionRead,
  listItem,
  page,
  renderLive,
  workspaceTrade,
  type CallFn,
  type FakeSocket,
} from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
const CODE = 'KMT-9042800-NG';

beforeEach(() => {
  api.call.mockReset();
});
afterEach(cleanup);

const push = (over: Record<string, unknown> = {}) => ({
  tradeId: id(1),
  tradeCode: CODE,
  kind: 'STATE_CHANGED',
  status: 'SHIPPED',
  previousStatus: 'FUNDED',
  action: 'BEGIN_CUSTODY',
  occurredAt: new Date(Date.now() + 2000).toISOString(),
  ...over,
});

/** Waits for the screen to be listening, then connects the socket the way socket.io-client does. */
const connect = async (fake: FakeSocket) => {
  await waitFor(() => expect(fake.listening('trade:updated')).toBe(true));
  act(() => {
    fake.fire('connect');
  });
};

describe('the workspace follows the trade', () => {
  let current: unknown;
  const serve = () =>
    answerWith(api.call, {
      'GET /trades/:id': () => current,
      'GET /trades/:id/delivery-deadline': deliveryDeadline(),
      'GET /trades/:id/inspection': inspectionRead(),
      'GET /trades/:id/activity': page([activityRow(1)]),
      'GET /trades': page([]),
    });
  const reads = () => callsTo(api.call, 'GET', '/trades/:id').length;

  it('joins the trade by its code once connected, and reads it again', async () => {
    current = workspaceTrade('FUNDED', 'BUYER');
    serve();
    const fake = fakeSocket();
    renderLive(api.call, fake, <TradeScreen id={id(1)} />);
    await screen.findByText('Funds protected');
    const before = reads();
    await connect(fake);
    await waitFor(() => expect(fake.joins()).toEqual([{ prefix: 'trade', id: CODE }]));
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
  });

  it('shows the new state after a push, taken from the read and not from the push', async () => {
    current = workspaceTrade('FUNDED', 'BUYER');
    serve();
    const fake = fakeSocket();
    renderLive(api.call, fake, <TradeScreen id={id(1)} />);
    await screen.findByText('Funds protected');
    await connect(fake);
    await waitFor(() => expect(fake.joins()).toHaveLength(1));

    // The platform moves it to INSPECTION. The push, wrongly or rightly, says SHIPPED: the screen shows the read.
    current = workspaceTrade('INSPECTION', 'BUYER');
    act(() => {
      fake.fire('trade:updated', push({ status: 'SHIPPED' }));
    });
    expect(await screen.findByText('Inspection active')).toBeTruthy();
    expect(screen.queryByText('In transit')).toBeNull();
  });

  it('shows the move that happened while the connection was down, because it reads again on reconnect', async () => {
    current = workspaceTrade('FUNDED', 'SELLER');
    serve();
    const fake = fakeSocket();
    renderLive(api.call, fake, <TradeScreen id={id(1)} />);
    await screen.findByText('Funds protected');
    await connect(fake);
    await waitFor(() => expect(fake.joins()).toHaveLength(1));

    // No push is ever received for this: the socket was down when the trade moved.
    current = workspaceTrade('SHIPPED', 'SELLER');
    act(() => {
      fake.fire('disconnect');
    });
    expect(screen.getByText('Funds protected')).toBeTruthy();
    act(() => {
      fake.fire('connect');
    });
    expect(await screen.findByText('In transit')).toBeTruthy();
    expect(fake.joins()).toHaveLength(2);
    expect(fake.joins()[1]).toEqual({ prefix: 'trade', id: CODE });
  });

  it('ignores a push older than what it last read', async () => {
    current = workspaceTrade('FUNDED', 'BUYER');
    serve();
    const fake = fakeSocket();
    renderLive(api.call, fake, <TradeScreen id={id(1)} />);
    await screen.findByText('Funds protected');
    await connect(fake);
    await waitFor(() => expect(fake.joins()).toHaveLength(1));
    await waitFor(() => expect(reads()).toBeGreaterThan(1));
    const before = reads();

    act(() => {
      fake.fire('trade:updated', push({ occurredAt: '2020-01-01T00:00:00.000Z' }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(reads()).toBe(before);
  });

  it('keeps working when the room is refused, by reading the trade', async () => {
    current = workspaceTrade('FUNDED', 'BUYER');
    serve();
    const fake = fakeSocket();
    fake.emitWithAck.mockResolvedValue({ joined: false, reason: 'FORBIDDEN' });
    renderLive(api.call, fake, <TradeScreen id={id(1)} />);
    await screen.findByText('Funds protected');
    await connect(fake);
    await waitFor(() => expect(fake.joins()).toHaveLength(1));
    expect(screen.getByText('Funds protected')).toBeTruthy();
  });

  it('refetches the activity too, so a new step appears in the feed without leaving the tab', async () => {
    current = workspaceTrade('FUNDED', 'BUYER');
    let rows = [activityRow(1)];
    answerWith(api.call, {
      'GET /trades/:id': () => current,
      'GET /trades/:id/activity': () => page(rows),
      'GET /trades': page([]),
      'GET /trades/:id/delivery-deadline': deliveryDeadline(),
      'GET /trades/:id/inspection': inspectionRead(),
    });
    const fake = fakeSocket();
    renderLive(api.call, fake, <TradeScreen id={id(1)} tab="activity" />);
    await screen.findByRole('list', { name: 'Trade activity' });
    await connect(fake);
    await waitFor(() => expect(fake.joins()).toHaveLength(1));

    current = workspaceTrade('SHIPPED', 'BUYER');
    rows = [activityRow(2, { kind: 'SHIPPED', actor: 'OTHER_PARTY', toStatus: 'SHIPPED' }), activityRow(1)];
    act(() => {
      fake.fire('trade:updated', push());
    });
    expect(await screen.findByText('Seller dispatched')).toBeTruthy();
  });
});

describe('the trades list follows its trades', () => {
  const rows = (status: string) => [
    listItem(1, { status, attention: null, awaiting: null, yourRole: 'BUYER' }),
    listItem(2, { status: 'DISPUTED', attention: null, awaiting: null, yourRole: 'BUYER' }),
  ];
  let current: unknown[];
  const serve = () => answerWith(api.call, { 'GET /trades': () => page(current) });

  it('joins every trade it shows, once connected', async () => {
    current = rows('FUNDED');
    serve();
    const fake = fakeSocket();
    renderLive(api.call, fake, <MyTrades />);
    await screen.findByText('Your Trades');
    await connect(fake);
    await waitFor(() => expect(fake.joins()).toHaveLength(2));
    expect(fake.joins()).toEqual(
      expect.arrayContaining([
        { prefix: 'trade', id: 'KMT-9000100-NG' },
        { prefix: 'trade', id: 'KMT-9000200-NG' },
      ]),
    );
  });

  it('reads the list when any of them moves, so the row changes without a focus', async () => {
    current = rows('FUNDED');
    serve();
    const fake = fakeSocket();
    renderLive(api.call, fake, <MyTrades />);
    await screen.findByText('Funds protected');
    await connect(fake);
    await waitFor(() => expect(fake.joins()).toHaveLength(2));
    await waitFor(() => expect(callsTo(api.call, 'GET', '/trades').length).toBeGreaterThan(1));

    current = rows('INSPECTION');
    act(() => {
      fake.fire(
        'trade:updated',
        push({
          tradeId: id(1),
          tradeCode: 'KMT-9000100-NG',
          occurredAt: new Date(Date.now() + 2000).toISOString(),
        }),
      );
    });
    expect(await screen.findByText('Inspection active')).toBeTruthy();
  });

  it('reads the list again on a reconnect, which is the only way to learn what a dropped push said', async () => {
    current = rows('FUNDED');
    serve();
    const fake = fakeSocket();
    renderLive(api.call, fake, <MyTrades />);
    await screen.findByText('Funds protected');
    await connect(fake);
    await waitFor(() => expect(fake.joins()).toHaveLength(2));
    await act(async () => {
      await Promise.resolve();
    });

    current = rows('SHIPPED');
    act(() => {
      fake.fire('disconnect');
    });
    act(() => {
      fake.fire('connect');
    });
    expect(await screen.findByText('In transit')).toBeTruthy();
    expect(fake.joins()).toHaveLength(4);
  });
});
