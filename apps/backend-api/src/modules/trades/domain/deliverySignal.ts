// The delivery-signal payload (design §7.5) and M7 §6's trust weighting, as pure functions. One
// consumer applies them (services/deliverySignal.service.ts); the courier package pipeline (T-087)
// and Park custody (T-093) publish to it in this shape and never decide anything themselves.
import { uuidSchema } from '@komtru/shared-types';
import { z } from 'zod';
import type { TradeAction, TradeStatus } from './stateMachine.js';

/** The `delivery_signal_source` enum: M2's provenance vocabulary, extended with PARK_CUSTODY (C3). */
export const DELIVERY_SIGNAL_SOURCES = [
  'BUYER_CONFIRMATION',
  'SELLER_SELF_REPORT',
  'PARTNER_PORTAL',
  'PARK_CUSTODY',
  'COURIER_API',
] as const;
export type DeliverySignalSource = (typeof DELIVERY_SIGNAL_SOURCES)[number];

/**
 * Design §7.5's payload. The design lists four sources; `COURIER_API` is the fifth M7 §6 weights
 * identically to `PARTNER_PORTAL` and the enum already carries, so the schema accepts the whole enum.
 */
export const deliverySignalPayloadSchema = z.object({
  tradeId: uuidSchema,
  source: z.enum(DELIVERY_SIGNAL_SOURCES),
  /** ISO, server time. */
  occurredAt: z.iso.datetime(),
  actorUserId: uuidSchema.nullable(),
  reference: z.object({ kind: z.enum(['LOGISTICS_PACKAGE', 'PARK_PARCEL']), id: uuidSchema }).nullable(),
  /** PARK_CUSTODY only. */
  hubId: uuidSchema.optional(),
});
export type DeliverySignalPayload = z.infer<typeof deliverySignalPayloadSchema>;

/**
 * Sources whose presence anywhere in a trade's history corroborates a later self-report: a real
 * courier or a Park hub was involved (M7 §6 "one-time partner-portal exception", design §6.2, which
 * adds custody to M7's two). A buyer's own confirmation is not on the list; it already moves the
 * trade by itself.
 */
export const PARTNER_HISTORY_SOURCES = ['PARTNER_PORTAL', 'COURIER_API', 'PARK_CUSTODY'] as const;

/** A signal that can start the inspection clock without anyone else's say-so. */
export const isTrustedSignal = (
  source: DeliverySignalSource,
  priorSources: readonly DeliverySignalSource[],
): boolean =>
  source !== 'SELLER_SELF_REPORT' ||
  priorSources.some((prior) => (PARTNER_HISTORY_SOURCES as readonly string[]).includes(prior));

export type SignalDecision =
  | {
      kind: 'MOVE';
      action: Extract<TradeAction, 'DELIVERY_SIGNAL' | 'CONFIRM_RECEIPT'>;
      to: Extract<TradeStatus, 'INSPECTION' | 'UNCONFIRMED_DELIVERY'>;
    }
  | { kind: 'RECORD_ONLY'; why: 'NOT_AWAITING_DELIVERY' | 'AWAITING_BUYER_OR_GRACE' };

/**
 * What a signal does to a trade in `status`. Design §6.2 draws exactly three arrows here:
 * SHIPPED -> INSPECTION (trusted), SHIPPED -> UNCONFIRMED_DELIVERY (self-report), and
 * UNCONFIRMED_DELIVERY -> INSPECTION (buyer confirms; the grace job is T-065's). A signal that
 * matches none of them is evidence, kept, and moves nothing.
 */
export function decideDeliverySignal(input: {
  status: TradeStatus;
  source: DeliverySignalSource;
  priorSources: readonly DeliverySignalSource[];
}): SignalDecision {
  const { status, source, priorSources } = input;
  if (status === 'SHIPPED') {
    return {
      kind: 'MOVE',
      action: 'DELIVERY_SIGNAL',
      to: isTrustedSignal(source, priorSources) ? 'INSPECTION' : 'UNCONFIRMED_DELIVERY',
    };
  }
  if (status === 'UNCONFIRMED_DELIVERY') {
    return source === 'BUYER_CONFIRMATION'
      ? { kind: 'MOVE', action: 'CONFIRM_RECEIPT', to: 'INSPECTION' }
      : { kind: 'RECORD_ONLY', why: 'AWAITING_BUYER_OR_GRACE' };
  }
  return { kind: 'RECORD_ONLY', why: 'NOT_AWAITING_DELIVERY' };
}
