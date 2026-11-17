// @vitest-environment jsdom
// F-044 (SP-M13): statements, built in the browser from the payouts and refunds the platform lists. The file that comes
// out is read back and checked: nothing here is stubbed except the browser's own "save a file".
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Statements } from '../src/account/statements/Statements';
import { expectNoAxeViolations } from './axe';
import { problem } from './support/account';
import { SHELL_RULES, answerWith, callsTo, refundRow, renderWithApi, type CallFn } from './support/workspace';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
const saved = vi.hoisted(() => ({ blobs: [] as Blob[], names: [] as string[] }));

const setOnline = (online: boolean) =>
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });

beforeEach(() => {
  api.call.mockReset();
  saved.blobs = [];
  saved.names = [];
  // The one thing a jsdom page cannot do: hand a file to the browser's downloads. Everything that goes into it is real.
  URL.createObjectURL = (blob: Blob | MediaSource) => {
    saved.blobs.push(blob as Blob);
    return 'blob:statement';
  };
  URL.revokeObjectURL = () => undefined;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.names.push(this.download);
  });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T12:00:00.000Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  setOnline(true);
});

const payout = (n: number, requestedAt: string, over: Record<string, unknown> = {}) => ({
  id: `0190b0a0-0000-7000-8000-00000000090${String(n)}`,
  reference: `payout-90${String(n)}`,
  status: 'SUCCEEDED',
  trigger: 'MANUAL',
  currency: 'NGN',
  amountMinor: '10000000',
  feeMinor: '5000',
  transferAmountMinor: '9995000',
  destination: null,
  sourceTradeId: null,
  failureReason: null,
  requestedAt,
  dispatchedAt: null,
  completedAt: null,
  failedAt: null,
  ...over,
});

const FEEDS = {
  'GET /me/payouts': {
    items: [payout(1, '2026-11-10T10:00:00.000Z'), payout(2, '2026-08-01T10:00:00.000Z')],
    nextCursor: null,
  },
  'GET /me/refunds': {
    items: [refundRow('PROCESSED', { requestedAt: '2026-11-14T10:00:00.000Z' })],
    nextCursor: null,
  },
};

const readBlob = (blob: Blob): Promise<string> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });

const readBytes = (blob: Blob): Promise<Uint8Array> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });

describe('Statements (SP-M13)', () => {
  it('draws the reference: period, format and what is included, and says what is not', async () => {
    const { container } = renderWithApi(api.call, <Statements />);
    expect(screen.getByRole('heading', { name: 'Statements' })).toBeDefined();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /^This month/ }).checked).toBe(true);
    for (const name of [/Last 3 months/, /Custom/]) expect(screen.getByRole('radio', { name })).toBeDefined();
    expect(screen.getByText('CSV')).toBeDefined();
    expect(screen.queryByText('PDF')).toBeNull();
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Payouts' }).checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Refunds' }).checked).toBe(true);
    expect(screen.getByText(/A statement lists what moved and when/)).toBeDefined();
    expect(screen.getByText(/Payments you made for Trades aren’t listed here/)).toBeDefined();
    expect(callsTo(api.call, 'GET', '/me/payouts')).toHaveLength(0);
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('exports what the ledger lists for the period, as a file it can be read back from', async () => {
    answerWith(api.call, FEEDS);
    renderWithApi(api.call, <Statements />);
    fireEvent.click(screen.getByRole('radio', { name: /Last 3 months/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Export statement' }));
    expect(await screen.findByText('Your statement is ready: 2 lines.')).toBeDefined();
    expect(saved.names).toEqual(['komtru-statement-2026-11-17.csv']);
    const text = await readBlob(saved.blobs[0] as Blob);
    // The text decoder drops a byte-order mark, so it is read off the bytes: Excel needs it to read UTF-8.
    const bytes = await readBytes(saved.blobs[0] as Blob);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text).toBe(
      'Date (Lagos),Type,Reference,Status,Amount (NGN),Fee (NGN),Sent (NGN)\r\n' +
        '2026-11-14 11:00,Refund,refund-501,Refunded,452000.00,6780.00,458780.00\r\n' +
        '2026-11-10 11:00,Payout,payout-901,Completed,100000.00,50.00,99950.00\r\n',
    );
  });

  it('leaves out what is switched off', async () => {
    answerWith(api.call, FEEDS);
    renderWithApi(api.call, <Statements />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Refunds' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export statement' }));
    await screen.findByText('Your statement is ready: 1 line.');
    expect(callsTo(api.call, 'GET', '/me/refunds')).toHaveLength(0);
    expect(await readBlob(saved.blobs[0] as Blob)).not.toContain('refund-501');
  });

  it('refuses a statement of nothing, and says so, rather than handing over an empty file', async () => {
    answerWith(api.call, {
      'GET /me/payouts': { items: [], nextCursor: null },
      'GET /me/refunds': { items: [], nextCursor: null },
    });
    const { container } = renderWithApi(api.call, <Statements />);
    fireEvent.click(screen.getByRole('button', { name: 'Export statement' }));
    expect(await screen.findByText('Nothing moved in this period')).toBeDefined();
    expect(saved.blobs).toHaveLength(0);
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('takes a custom period, and holds Export until it is one', async () => {
    answerWith(api.call, FEEDS);
    const { container } = renderWithApi(api.call, <Statements />);
    fireEvent.click(screen.getByRole('radio', { name: /Custom/ }));
    const exportButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Export statement' });
    expect(exportButton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-05' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-01' } });
    expect(screen.getByText('The end date is before the start date.')).toBeDefined();
    expect(exportButton.disabled).toBe(true);
    await expectNoAxeViolations(container, SHELL_RULES);
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-30' } });
    expect(exportButton.disabled).toBe(false);
    fireEvent.click(exportButton);
    await screen.findByText('Your statement is ready: 2 lines.');
  });

  it('shows it is preparing while it reads', async () => {
    api.call.mockImplementation(() => new Promise(() => undefined));
    const { container } = renderWithApi(api.call, <Statements />);
    fireEvent.click(screen.getByRole('button', { name: 'Export statement' }));
    expect(await screen.findByRole('status', { name: 'Preparing your statement' })).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('says it could not be made, keeps the choices, and offers another go', async () => {
    answerWith(api.call, {
      'GET /me/payouts': problem('INTERNAL', 500),
      'GET /me/refunds': FEEDS['GET /me/refunds'],
    });
    const { container } = renderWithApi(api.call, <Statements />);
    fireEvent.click(screen.getByRole('radio', { name: /Last 3 months/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Export statement' }));
    expect(await screen.findByText('We couldn’t make your statement')).toBeDefined();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Last 3 months/ }).checked).toBe(true);
    await expectNoAxeViolations(container, SHELL_RULES);
    answerWith(api.call, FEEDS);
    fireEvent.click(screen.getByRole('button', { name: 'Export statement' }));
    await waitFor(() => expect(saved.blobs).toHaveLength(1));
  });

  it('says offline in the person’s own words when it fails with no network', async () => {
    setOnline(false);
    answerWith(api.call, { 'GET /me/payouts': new TypeError('Failed to fetch') });
    const { container } = renderWithApi(api.call, <Statements />);
    fireEvent.click(screen.getByRole('button', { name: 'Export statement' }));
    expect(await screen.findByText('You’re offline')).toBeDefined();
    expect(screen.getByText(/Reconnect to make your statement/)).toBeDefined();
    await expectNoAxeViolations(container, SHELL_RULES);
  });
});
