// Request and response shapes for T-066's routes. Responses are loose objects pinning only what clients
// branch on, as the other trade validation files do: the service owns the view.
import { z } from 'zod';
import { BUYER_CANCELLATION_REASONS, SELLER_CANCELLATION_REASONS } from '../domain/cancellationEvents.js';

const note = z.string().trim().min(1).max(500).optional();

export const cancellationRequestParamSchema = z.object({ id: z.uuid(), requestId: z.uuid() });

export const cancellationRequestBodySchema = z.object({ reason: z.enum(BUYER_CANCELLATION_REASONS), note });
export const cancellationResponseBodySchema = z.object({ note });
export const cannotFulfilBodySchema = z.object({ reason: z.enum(SELLER_CANCELLATION_REASONS), note });

export const cancellationRequestResponseSchema = z.looseObject({
  id: z.uuid(),
  requestedByRole: z.enum(['BUYER', 'SELLER']),
  reason: z.string(),
  status: z.enum(['PENDING', 'APPROVED', 'DECLINED', 'LAPSED']),
});

export const cancellationViewSchema = z.looseObject({
  tradeId: z.uuid(),
  tradeStatus: z.string(),
  request: cancellationRequestResponseSchema.nullable(),
  refundRequested: z.boolean(),
  actions: z.looseObject({
    canRequest: z.boolean(),
    canRespond: z.boolean(),
    canCancelAsSeller: z.boolean(),
  }),
});
