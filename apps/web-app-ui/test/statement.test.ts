import { describe, expect, it } from 'vitest';
import {
  buildStatement,
  csvCell,
  koboDecimal,
  periodRange,
  toCsv,
  type StatementRow,
} from '../src/account/statements/statement';
import { refundRow } from './support/workspace';

const payout = (over: Record<string, unknown> = {}) => ({
  id: '0190b0a0-0000-7000-8000-000000000801',
  reference: 'payout-801',
  status: 'SUCCEEDED' as const,
  trigger: 'MANUAL' as const,
  currency: 'NGN',
  amountMinor: '10000000',
  feeMinor: '5000',
  transferAmountMinor: '9995000',
  destination: null,
  sourceTradeId: null,
  failureReason: null,
  requestedAt: '2026-11-10T10:00:00.000Z',
  dispatchedAt: null,
  completedAt: '2026-11-10T10:05:00.000Z',
  failedAt: null,
  ...over,
});

describe('koboDecimal', () => {
  it('writes kobo as naira with two decimals, exactly, with no floating point', () => {
    expect(koboDecimal('0')).toBe('0.00');
    expect(koboDecimal('5')).toBe('0.05');
    expect(koboDecimal('45878000')).toBe('458780.00');
    expect(koboDecimal('9007199254740993')).toBe('90071992547409.93');
  });
});

describe('periodRange', () => {
  const NOW = new Date('2026-11-17T12:00:00.000Z');

  it('this month runs from the 1st, Lagos time, to now', () => {
    const range = periodRange({ kind: 'this-month' }, NOW);
    expect(range).toEqual({ from: new Date('2026-10-31T23:00:00.000Z'), to: NOW });
  });

  it('the last 3 months are this month and the two before it, from their 1st', () => {
    const range = periodRange({ kind: 'last-3-months' }, NOW);
    expect(range?.from).toEqual(new Date('2026-08-31T23:00:00.000Z'));
  });

  it('a custom period takes whole Lagos days, both ends included', () => {
    const range = periodRange({ kind: 'custom', from: '2026-11-01', to: '2026-11-05' }, NOW);
    expect(range).toEqual({
      from: new Date('2026-10-31T23:00:00.000Z'),
      to: new Date('2026-11-05T22:59:59.999Z'),
    });
  });

  it('refuses a custom period that is back to front, or not dates', () => {
    expect(periodRange({ kind: 'custom', from: '2026-11-05', to: '2026-11-01' }, NOW)).toBeUndefined();
    expect(periodRange({ kind: 'custom', from: '', to: '2026-11-01' }, NOW)).toBeUndefined();
    expect(periodRange({ kind: 'custom', from: '2026-13-40', to: '2026-11-01' }, NOW)).toBeUndefined();
  });

  it('never reaches into the future', () => {
    const range = periodRange({ kind: 'custom', from: '2026-11-01', to: '2026-12-31' }, NOW);
    expect(range?.to).toEqual(NOW);
  });
});

describe('buildStatement', () => {
  const range = { from: new Date('2026-11-01T00:00:00.000Z'), to: new Date('2026-11-30T00:00:00.000Z') };

  it('keeps what falls in the period, newest first, from both lists', () => {
    const rows = buildStatement({
      range,
      payouts: [
        payout(),
        payout({
          id: '0190b0a0-0000-7000-8000-000000000802',
          reference: 'payout-802',
          requestedAt: '2026-10-01T10:00:00.000Z',
        }),
      ],
      refunds: [refundRow('PROCESSED', { requestedAt: '2026-11-14T10:00:00.000Z' })],
      include: { payouts: true, refunds: true },
    });
    expect(rows.map((row) => row.reference)).toEqual(['refund-501', 'payout-801']);
  });

  it('leaves out what was not asked for', () => {
    const rows = buildStatement({
      range,
      payouts: [payout()],
      refunds: [refundRow('PROCESSED')],
      include: { payouts: false, refunds: true },
    });
    expect(rows.map((row) => row.type)).toEqual(['Refund']);
  });

  it('states every amount as the ledger sent it', () => {
    const [row] = buildStatement({
      range,
      payouts: [payout()],
      refunds: [],
      include: { payouts: true, refunds: false },
    });
    expect(row).toMatchObject({ type: 'Payout', amount: '100000.00', fee: '50.00', sent: '99950.00' });
  });
});

describe('csvCell', () => {
  it('quotes what needs it', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('defuses a cell a spreadsheet would run as a formula', () => {
    for (const hostile of ['=SUM(A1)', '+1', '-1+1', '@cmd', '\t=1', '\r=1']) {
      expect(csvCell(hostile).replace(/^"/, '').startsWith("'")).toBe(true);
    }
  });
});

describe('toCsv', () => {
  it('writes a header and one line per row, with CRLF line ends and a byte-order mark for spreadsheets', () => {
    const row: StatementRow = {
      date: '2026-11-10 11:00',
      type: 'Payout',
      reference: 'payout-801',
      status: 'Completed',
      amount: '100000.00',
      fee: '50.00',
      sent: '99950.00',
    };
    expect(toCsv([row])).toBe(
      '\uFEFFDate (Lagos),Type,Reference,Status,Amount (NGN),Fee (NGN),Sent (NGN)\r\n2026-11-10 11:00,Payout,payout-801,Completed,100000.00,50.00,99950.00\r\n',
    );
  });
});
