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
import type { BuyerPath, TradePrincipal } from '../../domain/eligibility.js';
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
      actorType: 'SYSTEM',
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
