// `canActAsBuyer(userId)`: design section 6.3's "one identity function", with the lookup.
//
// The pure rule is `domain/capability.ts` (`canActAsBuyer(status)`), which party cards and
// invitations call with a status they already hold, and which trades delegates to. This is the same
// rule behind a user id, for a caller that has only the id. The barrel keeps exporting the pure
// function under its existing name because the trades module imports it; this one is reached as
// `createCapabilityService(...).canActAsBuyer(userId)`.
//
// "Trades already in flight finish normally" is NOT decided here. It is a fact about a trade (this
// person is already its buyer, and the trade predates their certification), and identity cannot see
// trades. A boolean flag from the caller would let any caller launder a new buyer-side commitment as
// an old one, so the exception lives in the trades module, which simply does not call this for a
// trade it is continuing (see `trades/domain/eligibility.ts`). This function answers one question
// only: may this person start acting as a buyer now.
import { eq } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { canActAsBuyer, type CapabilityStatus } from '../domain/capability.js';
import { userCapabilities } from '../infrastructure/postgres/schema/rbac.js';
import { users } from '../infrastructure/postgres/schema/users.js';

export interface BuyerFacts {
  /** `users.status`, or null when there is no such user. */
  userStatus: string | null;
  /** The MERCHANT capability's status, or null when the user has no such capability row. */
  merchantStatus: CapabilityStatus | null;
}

export type BuyerFactsLookup = (userId: string) => Promise<BuyerFacts>;

export interface CapabilityService {
  /**
   * False while the user holds an ACTIVE MERCHANT capability (a certified merchant is sell-only), and
   * false for any account that is not itself ACTIVE: a restricted, suspended, locked or unverified
   * account cannot take a new side in a trade whatever its capabilities say.
   */
  canActAsBuyer(userId: string): Promise<boolean>;
}

export function createCapabilityService(deps: { facts: BuyerFactsLookup }): CapabilityService {
  return {
    async canActAsBuyer(userId) {
      const facts = await deps.facts(userId);
      if (facts.userStatus !== 'ACTIVE') return false;
      return canActAsBuyer(facts.merchantStatus);
    },
  };
}

export const postgresBuyerFacts =
  (db: Pick<Db, 'select'>): BuyerFactsLookup =>
  async (userId) => {
    const user = (
      await db.select({ status: users.status }).from(users).where(eq(users.id, userId)).limit(1)
    )[0];
    const capabilities = await db
      .select({ capability: userCapabilities.capability, status: userCapabilities.status })
      .from(userCapabilities)
      .where(eq(userCapabilities.userId, userId));
    return {
      userStatus: user?.status ?? null,
      merchantStatus: capabilities.find((row) => row.capability === 'MERCHANT')?.status ?? null,
    };
  };
