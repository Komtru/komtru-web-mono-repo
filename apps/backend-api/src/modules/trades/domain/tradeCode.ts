// The human-facing reference for a trade: `KMT-7398512-NG`. The format is defined once, in
// shared-types (`tradeCodeSchema`), and issued here.
//
// Random rather than sequential, for the same reason as a public user id: a sequential code leaks
// how many trades the platform has done and makes the trade next to yours guessable. Seven digits
// is nine million codes, so repeats do happen — roughly six times in ten thousand draws. Uniqueness
// is `trades_trade_code_unique` plus a retry at the insert, never this function: a generator that
// could not repeat would be a sequence, which is what random codes exist to avoid. A code
// identifies a trade, it never authorises access to one.
import { randomInt } from 'node:crypto';
import { tradeCodeSchema } from '@komtru/shared-types';

const DIGITS = 7;
const FIRST = 10 ** (DIGITS - 1);
const LAST = 10 ** DIGITS;

/** Never starts with a zero, so the code a user reads back has the length they were shown. */
export const generateTradeCode = (): string => tradeCodeSchema.parse(`KMT-${randomInt(FIRST, LAST)}-NG`);
