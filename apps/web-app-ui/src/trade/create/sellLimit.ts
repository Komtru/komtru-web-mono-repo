import type { TradePreview } from '@komtru/api-client';
import { nairaShort as naira } from '../format';

/** Where an account goes to have its selling limit lifted. */
export const MERCHANT_STATUS_HREF = '/account/verification/merchant';

/**
 * What to tell a seller about the price they typed, before anything is sent (owner ruling 2026-11-20):
 * an account without merchant status sells at most a per-trade amount and a per-day total. `undefined`
 * when the price is within both, when the person has no limit (a certified merchant), or before the
 * platform has said. The platform decides again when the trade is sent; this only saves a refusal.
 */
export function sellLimitWarning(
  limit: TradePreview['sellLimit'],
  priceMinor: bigint | undefined,
): { title: string; body: string } | undefined {
  if (limit === null || limit === undefined || priceMinor === undefined) return undefined;
  if (priceMinor > BigInt(limit.perTradeMinor))
    return {
      title: `Over your ${naira(limit.perTradeMinor)} limit per trade`,
      body: `Without merchant status you can sell up to ${naira(limit.perTradeMinor)} on one trade. Lower the price, or get merchant status to sell more.`,
    };
  if (priceMinor > BigInt(limit.remainingTodayMinor))
    return {
      title: 'Over what you can sell today',
      body: `Without merchant status you can sell up to ${naira(limit.perDayMinor)} a day, and you have ${naira(limit.remainingTodayMinor)} left today. Try a lower price or tomorrow, or get merchant status to sell more.`,
    };
  return undefined;
}
