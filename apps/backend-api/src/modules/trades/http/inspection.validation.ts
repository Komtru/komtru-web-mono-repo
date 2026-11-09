// Request and response shapes for T-065's routes. Responses are loose objects pinning only what
// clients branch on, as fulfilment.validation.ts does: the services own the views.
import { z } from 'zod';

export const inspectionExtensionParamSchema = z.object({ id: z.uuid(), requestId: z.uuid() });

/** BEI1: a whole number of hours. The service holds the ceiling (one original window). */
export const inspectionExtensionBodySchema = z.object({
  extraHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30),
  note: z.string().trim().min(1).max(500).optional(),
});

export const inspectionResponseSchema = z.looseObject({
  tradeId: z.uuid(),
  tradeCode: z.string(),
  status: z.string(),
  yourRole: z.enum(['BUYER', 'SELLER']),
  window: z.looseObject({ hours: z.number(), autoReleasePaused: z.boolean() }),
  extensionRequest: z.looseObject({ id: z.uuid(), status: z.string() }).nullable(),
  canRequestMoreTime: z.boolean(),
  canRespondToRequest: z.boolean(),
  sellerProof: z.looseObject({ media: z.array(z.looseObject({ fileId: z.uuid() })) }),
  deliveryEvidence: z.looseObject({ signals: z.array(z.looseObject({ source: z.string() })) }),
  release: z.looseObject({ acknowledgement: z.string() }),
});

export const inspectionExtensionResponseSchema = z.looseObject({ id: z.uuid(), status: z.string() });
