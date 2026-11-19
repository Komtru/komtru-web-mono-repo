// @vitest-environment jsdom
// F-069 / F-073 (DX-32, TX-19): payouts and performance. The data and the actions are the phone's (`payouts.test.tsx`);
// what is tested here is the arrangement: the tiles, the balance beside the history, and the history as a table.
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Payouts } from '../src/payouts/Payouts';
import { expectNoAxeViolations } from './axe';
import { SHELL_RULES, answerWith, id, listItem, renderWithApi, type CallFn } from './support/trade';
import { PAYOUT_ID, payout, summary } from './support/payouts';
import { setWidth, type Width } from './support/viewport';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));

beforeEach(() => {
  api.call.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const list = (items: unknown[], nextCursor: string | null = null) => ({ items, nextCursor });
const order = (n: number, status: string) =>
  listItem(n, { status, yourRole: 'SELLER', attention: null, awaiting: null });
const dispute = (n: number, status: string) => ({
  id: id(n),
  disputeNumber: n,
  code: `DIS-0000${String(n)}`,
  tradeId: id(1),
  orderId: null,
  status,
  category: 'ITEM_NOT_AS_DESCRIBED',
  creationPath: 'DIRECT_FILING',
  openedReason: 'Not as described.',
  openedByUserId: id(80),
  buyerUserId: id(80),
  sellerUserId: id(81),
  totalEscrowMinor: '45200000',
  window: { kind: 'NONE', deadlineAt: null, remaining: null },
  mediationDeadlineAt: '2026-11-21T09:00:00.000Z',
  evidenceDeadlineAt: '2026-11-24T09:00:00.000Z',
  evidenceReopenedAt: null,
  decidedAt: null,
  appealDeadlineAt: null,
  appealFiledAt: null,
  closedAt: null,
  createdAt: '2026-11-19T09:00:00.000Z',
});

const serve = (more: Record<string, unknown> = {}) =>
  answerWith(api.call, {
    'GET /me/payouts/summary': summary(),
    'GET /me/payouts': list([
      payout(),
      payout({
        id: id(12),
        status: 'FAILED',
        amountMinor: '8950000',
        requestedAt: '2026-08-02T10:20:00.000Z',
      }),
    ]),
    'GET /trades': list([order(1, 'FUNDED'), order(2, 'FUNDED'), order(3, 'SHIPPED')]),
    'GET /disputes': list([dispute(4, 'MEDIATION'), dispute(5, 'CLOSED')]),
    ...more,
  });

describe.each([['tablet'], ['desktop']] as [Width][])('Payouts & performance at a %s', (width) => {
  beforeEach(() => setWidth(width));

  it('heads the screen, counts what the platform can count, and keeps the balance beside the history', async () => {
    serve();
    const { container } = renderWithApi(api.call, <Payouts />);
    expect(await screen.findByText('₦1,200,000')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Payouts & performance' })).toBeTruthy();
    expect(screen.getByText(/Where “funds released” lands, and how you are performing\./)).toBeTruthy();

    const tiles = await screen.findByRole('list', { name: 'How you are doing' });
    const tile = (name: string) => within(tiles).getByText(name).closest('li') as HTMLElement;
    expect(within(tile('To ship')).getByText('2')).toBeTruthy();
    expect(within(tile('In transit')).getByText('1')).toBeTruthy();
    // A closed case is not an open one.
    expect(within(tile('Open disputes')).getByText('1')).toBeTruthy();
    // What the platform has no figure for is not drawn.
    expect(screen.queryByText('Fulfilment')).toBeNull();
    expect(screen.queryByText('Avg dispatch')).toBeNull();

    expect(screen.getByRole('link', { name: 'Withdraw' }).getAttribute('href')).toBe(
      '/account/payouts/withdraw',
    );
    expect(screen.getByRole('link', { name: /GTBank •••• 5567.*Change/ })).toBeTruthy();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('lists the payouts as a table, each date opening its receipt, with how each ended', async () => {
    serve();
    renderWithApi(api.call, <Payouts />);
    const table = await screen.findByRole('table', { name: 'Payout history' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Date', 'To', 'Amount', 'Status']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('GTBank •••• 5567');
    expect(rows[0]?.textContent).toContain('₦452,000');
    expect(rows[0]?.textContent).toContain('Completed');
    expect(
      within(rows[0] as HTMLElement)
        .getByRole('link')
        .getAttribute('href'),
    ).toBe(`/account/payouts/${PAYOUT_ID}`);
    expect(rows[1]?.textContent).toContain('Didn’t go through');
    expect(screen.queryByRole('list', { name: 'Recent payouts' })).toBeNull();
  });

  it('still says there are no payouts yet, and reads older ones on request', async () => {
    serve({
      'GET /me/payouts': ({ query }: { query?: Record<string, unknown> }) =>
        query?.cursor === undefined ? list([payout()], 'c2') : list([payout({ id: id(13) })]),
    });
    renderWithApi(api.call, <Payouts />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show older payouts' }));
    expect(
      await within(await screen.findByRole('table', { name: 'Payout history' })).findAllByRole('link'),
    ).toHaveLength(2);
  });

  it('says so when there are no payouts', async () => {
    serve({ 'GET /me/payouts': list([]) });
    renderWithApi(api.call, <Payouts />);
    expect(await screen.findByText('No payouts yet')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('keeps a tile quiet rather than wrong when its figure cannot be read', async () => {
    serve({ 'GET /disputes': new Error('offline') });
    renderWithApi(api.call, <Payouts />);
    const tiles = await screen.findByRole('list', { name: 'How you are doing' });
    await within(tiles).findByText('To ship');
    const open = within(tiles).getByText('Open disputes').closest('li') as HTMLElement;
    expect(await within(open).findByText('—')).toBeTruthy();
  });

  it('still stops a withdrawal while payouts are paused', async () => {
    serve({ 'GET /me/payouts/summary': summary({ held: true }) });
    renderWithApi(api.call, <Payouts />);
    expect(await screen.findByText('Payouts on your account are paused')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Withdraw' }).disabled).toBe(true);
  });
});

describe('Payouts on a phone', () => {
  it('stays the single column, with its own heading and rows', async () => {
    setWidth('phone');
    answerWith(api.call, {
      'GET /me/payouts/summary': summary(),
      'GET /me/payouts': list([payout()]),
    });
    renderWithApi(api.call, <Payouts />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Payouts' })).toBeTruthy();
    expect(await screen.findByRole('list', { name: 'Recent payouts' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('list', { name: 'How you are doing' })).toBeNull();
  });
});
