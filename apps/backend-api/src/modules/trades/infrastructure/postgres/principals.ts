// Reading the facts the eligibility gates decide on, and recording a gate that fired.
//
// Identity is reached through its barrel (src/modules/identity/index.js), never its internals —
// komtru/module-boundaries enforces it. Design §6.3 makes `canActAsBuyer` one identity function;
// until identity has a service layer (T-031) the rule lives in this module's domain and this file
// supplies it with a principal. When identity exposes it, trades must delegate rather than keep a
// second copy of the rule.
import { and, eq } from 'drizzle-orm';
import { userCapabilities, users } from '../../../identity/index.js';
import { ApiError } from '../../../../platform/errors.js';
import { publish, type Tx } from '../../../../platform/events/publish.js';
import {
  assertCanActAsBuyer,
  assertFundingEligibility,
  canActAsBuyer,
  type BuyerPath,
  type TradePrincipal,
} from '../../domain/eligibility.js';
import { tradeEligibilityBlockedEvent, type EligibilityGate } from '../../domain/events.js';
import { tradeActivity } from './schema/audit.js';

/** One read per request. Live, never cached: M7 §5 wants the capability checked at the gate. */
export async function readTradePrincipal(tx: Tx, userId: string): Promise<TradePrincipal> {
  const [user] = await tx
    .select({ verificationLevel: users.verificationLevel })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');

  const [capability] = await tx
    .select({ status: userCapabilities.status })
    .from(userCapabilities)
    .where(and(eq(userCapabilities.userId, userId), eq(userCapabilities.capability, 'MERCHANT')));

  return {
    userId,
    merchantCapabilityStatus: capability?.status ?? null,
    verificationLevel: user.verificationLevel,
  };
}

/** Who the gate refused. SELLER_NOT_VERIFIED is about the seller; every other gate is the buyer. */
const actorFor = (gate: EligibilityGate): 'BUYER' | 'SELLER' =>
  gate === 'SELLER_NOT_VERIFIED' ? 'SELLER' : 'BUYER';

export interface EligibilityBlock {
  /** Absent when the gate fired before a trade existed — a merchant starting one as the buyer. */
  tradeId?: string;
  gate: EligibilityGate;
  path?: BuyerPath;
  actorId: string;
  detail?: string;
  correlationId?: string;
}

/**
 * M7 §5: a blocked gate is itself worth an event, so Risk sees the pattern when it happens again and
 * again for one account. Where there is a trade it also joins that trade's activity log, because the
 * person reading the timeline needs to know why the button did nothing.
 */
export async function recordEligibilityBlock(tx: Tx, block: EligibilityBlock): Promise<void> {
  if (block.tradeId) {
    await tx.insert(tradeActivity).values({
      tradeId: block.tradeId,
      type: 'ELIGIBILITY_BLOCKED',
      // The actor is the person who tried; the system is what refused.
      actorType: actorFor(block.gate),
      actorId: block.actorId,
      summary: block.detail ?? block.gate,
      metadata: { gate: block.gate, ...(block.path ? { path: block.path } : {}) },
    });
  }

  await publish(tx, tradeEligibilityBlockedEvent, {
    payload: {
      tradeId: block.tradeId ?? null,
      gate: block.gate,
      ...(block.path ? { path: block.path } : {}),
      actorId: block.actorId,
      ...(block.detail ? { detail: block.detail } : {}),
    },
    aggregateType: 'trade',
    ...(block.tradeId ? { aggregateId: block.tradeId } : {}),
    actor: { type: 'CONSUMER', id: block.actorId },
    ...(block.correlationId ? { correlationId: block.correlationId } : {}),
  });
}

/**
 * The buyer gate, recorded and then raised. Two calls — assert, and publish — are two calls a
 * caller can get half right: a service that threw without recording would leave Risk blind to a
 * merchant trying every buyer path in turn, and nothing but review would notice. This is the one
 * the flow tickets call; `canActAsBuyer` stays pure for the display path (`PartyCard.canBuy`),
 * where nothing is being refused yet.
 */
export async function blockBuyerOrPass(
  tx: Tx,
  principal: TradePrincipal,
  path: BuyerPath,
  tradeId?: string,
): Promise<void> {
  if (canActAsBuyer(principal)) return;
  await recordEligibilityBlock(tx, {
    ...(tradeId ? { tradeId } : {}),
    gate: 'MERCHANT_CANNOT_BUY',
    path,
    actorId: principal.userId,
  });
  assertCanActAsBuyer(principal, path);
}

/** The funding gates, recorded and then raised, for the same reason as the buyer gate. */
export async function assertFundingEligibilityRecorded(
  tx: Tx,
  tradeId: string,
  buyer: TradePrincipal,
  seller: TradePrincipal,
): Promise<void> {
  try {
    assertFundingEligibility(buyer, seller);
  } catch (error) {
    const gate = (error as { code?: EligibilityGate }).code;
    if (gate === 'BUYER_NOT_VERIFIED' || gate === 'SELLER_NOT_VERIFIED') {
      await recordEligibilityBlock(tx, {
        tradeId,
        gate,
        actorId: gate === 'SELLER_NOT_VERIFIED' ? seller.userId : buyer.userId,
      });
    }
    throw error;
  }
}
