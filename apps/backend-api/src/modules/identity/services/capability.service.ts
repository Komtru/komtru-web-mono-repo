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
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import type { Tx } from '../../../platform/events/publish.js';
import { canActAsBuyer, type CapabilityStatus } from '../domain/capability.js';
import { userCapabilities } from '../infrastructure/postgres/schema/rbac.js';
import { users } from '../infrastructure/postgres/schema/users.js';
import { AUDIT_ACTIONS, writeAudit } from './audit.service.js';

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

// --- T-055: the write half --------------------------------------------------------------------------
//
// The MERCHANT capability is activated, suspended and revoked here and nowhere else (design 6.3), so the
// buy block `canActAsBuyer` reads is only ever moved by a function that also writes the audit row. Each
// takes the caller's transaction: certification is one transaction, and a capability that went ACTIVE
// while the rest of the approval rolled back would be a merchant with no profile.

export type CapabilityName = 'MERCHANT' | 'MERCHANT_MEMBER' | 'STAFF';

export interface CapabilityChange {
  /** The status before; null when the user had no row for this capability. */
  from: CapabilityStatus | null;
  changed: boolean;
}

const currentStatus = async (
  tx: Tx,
  userId: string,
  capability: CapabilityName,
): Promise<CapabilityStatus | null> => {
  const [row] = await tx
    .select({ status: userCapabilities.status })
    .from(userCapabilities)
    .where(and(eq(userCapabilities.userId, userId), eq(userCapabilities.capability, capability)))
    .for('update');
  return row?.status ?? null;
};

/**
 * Makes the capability ACTIVE, creating the row if the user has none. Idempotent: an already ACTIVE
 * capability is left alone and nothing is audited. `grantedBy` is the staff member whose decision this
 * is, or null when the system acts.
 */
export async function activateCapability(
  tx: Tx,
  input: { userId: string; capability: CapabilityName; grantedBy: string | null; reason: string },
): Promise<CapabilityChange> {
  const from = await currentStatus(tx, input.userId, input.capability);
  if (from === 'ACTIVE') return { from, changed: false };

  await tx
    .insert(userCapabilities)
    .values({
      userId: input.userId,
      capability: input.capability,
      status: 'ACTIVE',
      activatedAt: new Date(),
      grantedBy: input.grantedBy,
    })
    .onConflictDoUpdate({
      target: [userCapabilities.userId, userCapabilities.capability],
      set: {
        status: 'ACTIVE',
        activatedAt: sql`now()`,
        suspendedAt: null,
        suspensionReason: null,
        grantedBy: input.grantedBy,
        updatedAt: sql`now()`,
      },
    });
  await writeAudit(tx, {
    action: AUDIT_ACTIONS.CAPABILITY_ACTIVATED,
    outcome: 'SUCCESS',
    actorType: input.grantedBy === null ? 'SYSTEM' : 'STAFF',
    actorUserId: input.grantedBy,
    subjectUserId: input.userId,
    metadata: { capability: input.capability, from, reason: input.reason },
  });
  return { from, changed: true };
}

const endCapability = async (
  tx: Tx,
  to: 'SUSPENDED' | 'REVOKED',
  input: { userId: string; capability: CapabilityName; reason: string; actorUserId?: string | null },
): Promise<CapabilityChange> => {
  const from = await currentStatus(tx, input.userId, input.capability);
  if (from === null || from === 'PENDING') {
    throw new ApiError(
      409,
      'CONFLICT',
      `That account does not hold the ${input.capability} capability`,
      'There is nothing to suspend or revoke.',
    );
  }
  if (from === to) return { from, changed: false };
  await tx
    .update(userCapabilities)
    .set({
      status: to,
      suspendedAt: sql`now()`,
      suspensionReason: input.reason,
      updatedAt: sql`now()`,
    })
    .where(and(eq(userCapabilities.userId, input.userId), eq(userCapabilities.capability, input.capability)));
  await writeAudit(tx, {
    action: to === 'SUSPENDED' ? AUDIT_ACTIONS.CAPABILITY_SUSPENDED : AUDIT_ACTIONS.CAPABILITY_REVOKED,
    outcome: 'SUCCESS',
    actorType: input.actorUserId ? 'STAFF' : 'SYSTEM',
    actorUserId: input.actorUserId ?? null,
    subjectUserId: input.userId,
    metadata: { capability: input.capability, from, reason: input.reason },
  });
  return { from, changed: true };
};

export const suspendCapability = (
  tx: Tx,
  input: { userId: string; capability: CapabilityName; reason: string; actorUserId?: string | null },
): Promise<CapabilityChange> => endCapability(tx, 'SUSPENDED', input);

export const revokeCapability = (
  tx: Tx,
  input: { userId: string; capability: CapabilityName; reason: string; actorUserId?: string | null },
): Promise<CapabilityChange> => endCapability(tx, 'REVOKED', input);
