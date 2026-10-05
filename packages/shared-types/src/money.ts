// Money is kobo (1/100 naira) held as `bigint`, and a decimal digit string on the wire.
// A JavaScript `number` never holds money anywhere in Komtru: floats lose kobo, and JSON numbers lose
// precision past 2^53. Every amount crossing an API boundary goes through `koboSchema`.
import { z } from 'zod';

const KOBO_PATTERN = /^-?\d+$/;

/** A JSON amount in kobo: a string of digits, optionally negative (ledger balances can be). */
export const koboSchema = z
  .string()
  .regex(KOBO_PATTERN, 'Amount must be a whole number of kobo, as a string of digits')
  .transform((value) => BigInt(value));

/** A price or payment: strictly greater than zero. */
export const positiveKoboSchema = koboSchema.refine((kobo) => kobo > 0n, 'Amount must be greater than zero');

export type Kobo = bigint;

export const koboToJson = (kobo: Kobo): string => kobo.toString();

const groupThousands = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** `45200000n` → `₦452,000.00`; negative amounts render as `-₦1,500.00`. */
export function formatNaira(kobo: Kobo, options: { showKobo?: boolean } = {}): string {
  const { showKobo = true } = options;
  const sign = kobo < 0n ? '-' : '';
  const abs = kobo < 0n ? -kobo : kobo;
  const naira = groupThousands((abs / 100n).toString());
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return `${sign}₦${naira}${showKobo ? `.${fraction}` : ''}`;
}

const NAIRA_TEXT = /^(-)?₦?((?:\d|,(?=\d))+)(?:\.(\d{1,2}))?$/;

/** Parses typed naira (`"452,000.50"`, `"₦1,500.5"`) into kobo exactly, without floating point. */
export function nairaToKobo(input: string): Kobo {
  const match = NAIRA_TEXT.exec(input.trim());
  if (!match) throw new RangeError('Enter an amount in naira, with at most two decimal places');
  const [, minus, whole = '', fraction = ''] = match;
  const kobo = BigInt(whole.replaceAll(',', '')) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  return minus ? -kobo : kobo;
}

const BPS_SCALE = 10_000n;

/**
 * `amount × bps / 10,000`, rounded half up to the kobo. Basis points keep fee rates integral:
 * 150 bps is 1.5%. Inputs must be non-negative; fees are computed on amounts, never on balances.
 */
export function applyBps(amount: Kobo, bps: bigint): Kobo {
  if (amount < 0n || bps < 0n) throw new RangeError('applyBps takes a non-negative amount and rate');
  return (amount * bps + BPS_SCALE / 2n) / BPS_SCALE;
}
