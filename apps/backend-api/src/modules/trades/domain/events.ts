// The events every trade transition publishes, through the transactional outbox (design §4.3), in
// the same transaction as the change — so a rollback publishes nothing and a commit cannot lose it.
//
// M7 §7 names its events with two segments (`trade.funded`); the platform envelope requires three
// (`module.aggregate.event`), so they map onto `trades.trade.*`. One `state_changed` event carries
// every transition rather than fifteen near-identical ones: a consumer that only cares about
// funding filters on `to`, and a flow ticket that needs a richer payload (shipping details, dispute
// outcome) publishes its own event alongside this one.
import { defineEvent, tradeCodeSchema, uuidSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { TRADE_ACTIONS, TRADE_STATUSES } from './stateMachine.js';
import { BUYER_PATHS } from './eligibility.js';

export const TRADE_ACTOR_TYPES = ['BUYER', 'SELLER', 'SYSTEM', 'STAFF', 'LEDGER', 'LOGISTICS'] as const;
export type TradeActorType = (typeof TRADE_ACTOR_TYPES)[number];

export const tradeStateChangedEvent = defineEvent(
  'trades.trade.state_changed',
  1,
  z.object({
    tradeId: uuidSchema,
    tradeCode: tradeCodeSchema,
    action: z.enum(TRADE_ACTIONS),
    from: z.enum(TRADE_STATUSES),
    to: z.enum(TRADE_STATUSES),
    actorType: z.enum(TRADE_ACTOR_TYPES),
    actorId: uuidSchema.optional(),
    reason: z.string().optional(),
  }),
);

/** M7 §5: a blocked gate is itself worth an event, so Risk sees a pattern across accounts. */
export const ELIGIBILITY_GATES = [
  'MERCHANT_CANNOT_BUY',
  'BUYER_NOT_VERIFIED',
  'SELLER_NOT_VERIFIED',
] as const;
export type EligibilityGate = (typeof ELIGIBILITY_GATES)[number];

export const tradeEligibilityBlockedEvent = defineEvent(
  'trades.eligibility.blocked',
  1,
  z.object({
    /** Null when the gate fired before a trade existed — a merchant starting one as the buyer. */
    tradeId: uuidSchema.nullable(),
    gate: z.enum(ELIGIBILITY_GATES),
    path: z.enum(BUYER_PATHS).optional(),
    actorId: uuidSchema,
    detail: z.string().optional(),
  }),
);
