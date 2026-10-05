// Money is kobo (1/100 naira) held as `bigint`, and a decimal digit string on the wire.
// A JavaScript `number` never holds money anywhere in Komtru: floats lose kobo, and JSON numbers lose
// precision past 2^53. Every amount crossing an API boundary goes through `koboSchema`.
import { z } from 'zod';

/** Postgres BIGINT bounds: every amount must fit the column it is stored in. */
export const KOBO_MAX = 9_223_372_036_854_775_807n;
export const KOBO_MIN = -9_223_372_036_854_775_808n;

// At most 19 digits: anything longer is out of range, and is rejected before BigInt() parses it.
const KOBO_WIRE = z
  .string()
  .regex(/^-?\d{1,19}$/, 'Amount must be a whole number of kobo, as a string of digits');

/**
 * A JSON amount in kobo: a string of digits, optionally negative (ledger balances can be).
 * A two-way codec: `parse`/`decode` turn the wire string into bigint, and `encode` turns bigint back
 * into the wire string, so a response DTO containing money serialises with `schema.encode(dto)`.
 */
export const koboSchema = z.codec(KOBO_WIRE, z.bigint().min(KOBO_MIN).max(KOBO_MAX), {
  decode: (value) => BigInt(value),
  encode: (kobo) => kobo.toString(),
});

/**
 * A non-negative JSON amount, validated but NOT decoded: for money that stays a string all the way
 * into JSONB or a response body. `koboSchema` is a codec, so using it on a response schema would
 * hand `res.json` a bigint; this is the same vocabulary without the decode step. The range bound
 * matters as much as the digit count — `9999999999999999999` is 19 digits and overflows BIGINT.
 */
export const koboJsonSchema = z
  .string()
  .regex(/^\d{1,19}$/, 'Amount must be a whole number of kobo, as a string of digits')
  // zod runs every check, including after the regex failed, so this must tolerate a non-numeric
  // string rather than letting BigInt() throw a SyntaxError out of a safeParse.
  .refine(
    (value) => !/^\d{1,19}$/.test(value) || BigInt(value) <= KOBO_MAX,
    'Amount is larger than a BIGINT column can hold',
  );

/** A price or payment: strictly greater than zero. */
export const positiveKoboSchema = koboSchema.refine((kobo) => kobo > 0n, 'Amount must be greater than zero');

export type Kobo = bigint;
/** The wire form of an amount, as clients send and receive it. */
export type KoboJson = z.input<typeof koboSchema>;

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

// Thousands separators must sit every three digits (`1,000,000`), or be absent (`1000000`). A comma
// anywhere else (`1,000,00`, typed by someone used to decimal commas) is an error, never a guess.
const NAIRA_TEXT = /^(-)?₦?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

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
