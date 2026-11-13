// Who the app shell is being drawn for (F-037): the facts about a signed-in person that decide which
// destinations their shell has. `GET /me/viewer` answers them; the web app's auth route seals them into the
// session hint, because a page render holds no credential to ask with.
//
// Facts only, never permissions: every route behind a destination still authorises the caller itself.
import { z } from 'zod';
import type { TradeStatus } from './trades.js';

/**
 * The statuses in which a trade's money reached the seller. Being the seller on one of these is what "has
 * sold" means: before the first sale completes a seller has nothing to collect, and a refunded trade paid
 * them nothing.
 */
export const SOLD_TRADE_STATUSES = [
  'COMPLETED',
  'SETTLED',
  'RESOLVED_RELEASED',
] as const satisfies readonly TradeStatus[];

export const viewerFactsSchema = z.object({
  /** The seller on at least one trade in `SOLD_TRADE_STATUSES`. Merchant or not: a casual seller has payouts too. */
  hasSold: z.boolean(),
  /** Holds an `ACTIVE` `MERCHANT` capability, which makes the account sell-only (design §6.3). */
  certifiedMerchant: z.boolean(),
});
export type ViewerFacts = z.infer<typeof viewerFactsSchema>;
