// `GET /me/viewer` (F-037): the facts the app shell is drawn from, for the person asking.
//
// Two reads and nothing stored. The web app seals the answer into its session hint on every sign-in and
// refresh, so this is called once per token, not once per page.
import { SOLD_TRADE_STATUSES, type ViewerFacts } from '@komtru/shared-types';
import { and, eq, inArray } from 'drizzle-orm';
import { userCapabilities } from '../../identity/index.js';
import type { Db } from '../../../db/index.js';
import { trades } from '../infrastructure/postgres/schema/trades.js';

export interface ViewerDeps {
  db: Db;
}

export async function getViewerFacts(deps: ViewerDeps, userId: string): Promise<ViewerFacts> {
  const [sold, merchant] = await Promise.all([
    // `trades_seller_idx` leads with the seller, so this is an index probe however many trades there are.
    deps.db
      .select({ id: trades.id })
      .from(trades)
      .where(and(eq(trades.sellerUserId, userId), inArray(trades.status, [...SOLD_TRADE_STATUSES])))
      .limit(1),
    deps.db
      .select({ status: userCapabilities.status })
      .from(userCapabilities)
      .where(and(eq(userCapabilities.userId, userId), eq(userCapabilities.capability, 'MERCHANT')))
      .limit(1),
  ]);
  return { hasSold: sold.length > 0, certifiedMerchant: merchant[0]?.status === 'ACTIVE' };
}
