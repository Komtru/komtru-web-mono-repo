// `canActAsBuyer(userId)`: design section 6.3's "one identity function", with the lookup.
//
// The pure rule is `domain/capability.ts` (`canActAsBuyer(status)`), which party cards and
// invitations call with a status they already hold, and which trades delegates to. This is the same
// rule behind a user id, for a caller that has only the id. The barrel keeps exporting the pure
// function under its existing name because the trades module imports it; this one is reached as
// `createCapabilityService(...).canActAsBuyer(userId)`.
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { canActAsBuyer, type CapabilityStatus } from '../domain/capability.js';
import { userCapabilities } from '../infrastructure/postgres/schema/rbac.js';

/** The user's MERCHANT capability status, or null when they have no such capability row. */
export type MerchantStatusLookup = (userId: string) => Promise<CapabilityStatus | null>;

export interface CapabilityService {
  /**
   * False while the user holds an ACTIVE MERCHANT capability: a certified merchant is sell-only.
   *
   * `tradeInFlight` is how a trade that already exists finishes normally. Certification arriving
   * mid-trade must not strand a buyer who has already paid, so a caller answering "may this person
   * carry on with the trade they are already in" passes it and gets true; a caller answering "may
   * this person become a buyer now" (creating, being named, accepting, claiming, checking out)
   * leaves it off.
   */
  canActAsBuyer(userId: string, options?: { tradeInFlight?: boolean }): Promise<boolean>;
}

export function createCapabilityService(deps: { merchantStatus: MerchantStatusLookup }): CapabilityService {
  return {
    async canActAsBuyer(userId, options = {}) {
      if (options.tradeInFlight === true) return true;
      return canActAsBuyer(await deps.merchantStatus(userId));
    },
  };
}

export const postgresMerchantStatus =
  (db: Pick<Db, 'select'>): MerchantStatusLookup =>
  async (userId) =>
    (
      await db
        .select({ status: userCapabilities.status })
        .from(userCapabilities)
        .where(and(eq(userCapabilities.userId, userId), eq(userCapabilities.capability, 'MERCHANT')))
        .limit(1)
    )[0]?.status ?? null;
