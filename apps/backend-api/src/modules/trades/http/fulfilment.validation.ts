// Request and response shapes for T-064's routes. Responses are loose objects pinning only what
// clients branch on, as trade.validation.ts does: the services own the views.
import { z } from 'zod';
import { selfArrangedShipmentSchema } from '../domain/fulfilment.js';
import { DELIVERY_EXTENSION_REASONS } from '../domain/fulfilmentEvents.js';

export const extensionParamSchema = z.object({ id: z.uuid(), requestId: z.uuid() });

export const selfArrangedBodySchema = selfArrangedShipmentSchema;

export const extensionBodySchema = z.object({
  reason: z.enum(DELIVERY_EXTENSION_REASONS),
  requestedDueAt: z.iso.datetime().transform((value) => new Date(value)),
  note: z.string().trim().min(1).max(500).optional(),
});

export const shipOptionsResponseSchema = z.looseObject({
  tradeId: z.uuid(),
  tradeCode: z.string(),
  options: z.array(
    z.looseObject({ kind: z.enum(['PARK', 'COMPANY', 'SELF_ARRANGED']), available: z.boolean() }),
  ),
});

export const deliveryDeadlineResponseSchema = z.looseObject({
  deadline: z.looseObject({ id: z.uuid(), status: z.string(), dueAt: z.string() }).nullable(),
  extensionRequest: z.looseObject({ id: z.uuid(), status: z.string() }).nullable(),
});

export const extensionResponseSchema = z.looseObject({ id: z.uuid(), status: z.string() });
