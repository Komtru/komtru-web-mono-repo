// The selling limit (owner ruling 2026-11-20). There are no buyer accounts and seller accounts:
// any account buys and sells, and merchant status is what lifts the cap on selling. An account
// without an ACTIVE MERCHANT capability may sell at most `perTradeMinor` on one trade and
// `perDayMinor` in total per Lagos calendar day. Buying is never limited.
//
// The amounts come from config/fees.yaml through `TradeDeps.sellLimit()`; none appears here.
// "Today's total" is read by `sellingTodayMinor` (infrastructure/postgres/sellLimit.ts).
import type { Kobo } from '@komtru/shared-types';
import { sellLimitDailyError, sellLimitPerTradeError } from './errors.js';
import type { CapabilityStatus } from './eligibility.js';

export interface SellLimit {
  readonly perTradeMinor: Kobo;
  readonly perDayMinor: Kobo;
}

/** A certified merchant has no selling limit; everyone else has the configured one. */
export const sellLimitFor = (
  merchantCapabilityStatus: CapabilityStatus | null,
  limit: SellLimit,
): SellLimit | null => (merchantCapabilityStatus === 'ACTIVE' ? null : limit);

/** What is left to sell today, never below zero. `null` means no limit. */
export function remainingToday(limit: SellLimit | null, soldTodayMinor: Kobo): Kobo | null {
  if (limit === null) return null;
  const left = limit.perDayMinor - soldTodayMinor;
  return left > 0n ? left : 0n;
}

/**
 * Refuses a selling commitment over either limit. `soldTodayMinor` must NOT already include this
 * trade: a counter or an acceptance replaces the trade's earlier amount, it does not add to it.
 */
export function assertWithinSellLimit(
  limit: SellLimit | null,
  amountMinor: Kobo,
  soldTodayMinor: Kobo,
): void {
  if (limit === null) return;
  if (amountMinor > limit.perTradeMinor) throw sellLimitPerTradeError(limit.perTradeMinor);
  if (soldTodayMinor + amountMinor > limit.perDayMinor)
    throw sellLimitDailyError(limit.perDayMinor, remainingToday(limit, soldTodayMinor) ?? 0n);
}
