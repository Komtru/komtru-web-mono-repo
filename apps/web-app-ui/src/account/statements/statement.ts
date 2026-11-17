// SP-M13: a statement is built in the browser from two lists the platform already returns, `GET /me/payouts` and
// `GET /me/refunds`. Nothing is computed that the ledger did not say: every amount is a kobo string written out as naira
// and never summed, and a row is a payout or a refund exactly as listed. There is no statement service, and no list of a
// person's payments for Trades, so neither is in here (the screen says so).
import type { Payout, Refund } from '@komtru/api-client';
import { payoutStatus } from '../../payouts/format';

export type PeriodChoice =
  { kind: 'this-month' } | { kind: 'last-3-months' } | { kind: 'custom'; from: string; to: string };

export interface Range {
  from: Date;
  to: Date;
}

/** Lagos is UTC+1 all year (no daylight saving), which is why a day's start is a fixed hour before UTC's. */
const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const lagosDayStart = (year: number, month: number, day: number): Date =>
  new Date(Date.UTC(year, month - 1, day) - LAGOS_OFFSET_MS);

function lagosYearMonth(now: Date): { year: number; month: number } {
  const shifted = new Date(now.getTime() + LAGOS_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

/** The Lagos calendar day of an instant, as `2026-11-17`: the day a date input's `max` and a file's name should use. */
export function lagosDate(at: Date): string {
  const { year, month } = lagosYearMonth(at);
  const day = new Date(at.getTime() + LAGOS_OFFSET_MS).getUTCDate();
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDay(text: string): { year: number; month: number; day: number } | undefined {
  const match = DATE_INPUT.exec(text);
  if (match === null) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  const real =
    check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
  return real ? { year, month, day } : undefined;
}

/** The instants a choice covers, in Lagos days. `undefined` for a custom period that is not one. */
export function periodRange(choice: PeriodChoice, now: Date): Range | undefined {
  if (choice.kind === 'this-month' || choice.kind === 'last-3-months') {
    const { year, month } = lagosYearMonth(now);
    const first = choice.kind === 'this-month' ? month : month - 2;
    // `Date.UTC` carries a month below 1 into the year before.
    return { from: lagosDayStart(year, first, 1), to: now };
  }
  const from = parseDay(choice.from);
  const to = parseDay(choice.to);
  if (from === undefined || to === undefined) return undefined;
  const start = lagosDayStart(from.year, from.month, from.day);
  const endOfDay = new Date(lagosDayStart(to.year, to.month, to.day).getTime() + 24 * 60 * 60 * 1000 - 1);
  if (endOfDay < start) return undefined;
  return { from: start, to: endOfDay > now ? now : endOfDay };
}

/** `45878000` → `458780.00`. BigInt, so a large amount is exact. */
export function koboDecimal(kobo: string): string {
  const value = BigInt(kobo);
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, '0');
  return `${whole.toString()}.${fraction}`;
}

export interface StatementRow {
  /** Lagos time, `2026-11-10 11:00`. */
  date: string;
  type: 'Payout' | 'Refund';
  reference: string;
  status: string;
  amount: string;
  fee: string;
  /** What was sent: to the bank for a payout, back to the payment method for a refund. */
  sent: string;
}

const REFUND_STATUS: Record<Refund['status'], string> = {
  REQUESTED: 'Requested',
  PROCESSING: 'On its way',
  PROCESSED: 'Refunded',
  FAILED: 'Held',
  NEEDS_REVIEW: 'Held',
};

const lagosStamp = (iso: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
};

export interface Include {
  payouts: boolean;
  refunds: boolean;
}

export function buildStatement(input: {
  range: Range;
  payouts: readonly Payout[];
  refunds: readonly Refund[];
  include: Include;
}): StatementRow[] {
  const { range, include } = input;
  const within = (iso: string): boolean => {
    const at = new Date(iso);
    return at >= range.from && at <= range.to;
  };
  const rows: { at: string; row: StatementRow }[] = [];
  if (include.payouts) {
    for (const payout of input.payouts.filter((entry) => within(entry.requestedAt))) {
      rows.push({
        at: payout.requestedAt,
        row: {
          date: lagosStamp(payout.requestedAt),
          type: 'Payout',
          reference: payout.reference,
          status: payoutStatus(payout.status).label,
          amount: koboDecimal(payout.amountMinor),
          fee: koboDecimal(payout.feeMinor),
          sent: koboDecimal(payout.transferAmountMinor),
        },
      });
    }
  }
  if (include.refunds) {
    for (const refund of input.refunds.filter((entry) => within(entry.requestedAt))) {
      rows.push({
        at: refund.requestedAt,
        row: {
          date: lagosStamp(refund.requestedAt),
          type: 'Refund',
          reference: refund.reference,
          status: REFUND_STATUS[refund.status],
          amount: koboDecimal(refund.itemAmountMinor),
          fee: koboDecimal(refund.feeAmountMinor),
          sent: koboDecimal(refund.amountMinor),
        },
      });
    }
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at)).map((entry) => entry.row);
}

/**
 * One CSV cell. A text cell a spreadsheet would read as a formula (`=`, `+`, `-`, `@`, or a tab or return before one) is
 * given a leading apostrophe, so a reference or a status can never run as one when the file is opened.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const HEADER = ['Date (Lagos)', 'Type', 'Reference', 'Status', 'Amount (NGN)', 'Fee (NGN)', 'Sent (NGN)'];

/** CRLF line ends and a byte-order mark, which is what Excel needs to read the file as UTF-8. */
export function toCsv(rows: readonly StatementRow[]): string {
  const lines = [HEADER.join(',')];
  for (const row of rows) {
    lines.push(
      [row.date, row.type, row.reference, row.status, row.amount, row.fee, row.sent].map(csvCell).join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
