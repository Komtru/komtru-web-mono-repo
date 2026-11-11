// The ship step (T-064, F-026): what the seller may choose and shipping with their own arrangement.
// Mirrors `apps/backend-api/src/modules/trades/http/fulfilment.routes.ts` field for field.
//
// Which options are offered is the platform's decision, computed from the trade's cities and the enabled
// companies: a screen renders the list it is given and never works out availability itself. Park is always
// listed, with the reason when it is not available.
import { z } from 'zod';
import { defineEndpoint } from './contracts.js';
import { tradeViewSchema } from './trades.js';

const tradeParams = z.object({ id: z.uuid() });

const parkReasonSchema = z.looseObject({ code: z.string(), message: z.string() });

export const shipOptionSchema = z.discriminatedUnion('kind', [
  z.looseObject({
    kind: z.literal('PARK'),
    label: z.string(),
    available: z.boolean(),
    reason: parkReasonSchema.nullable(),
  }),
  z.looseObject({
    kind: z.literal('COMPANY'),
    companyId: z.string(),
    name: z.string(),
    available: z.boolean(),
  }),
  z.looseObject({
    kind: z.literal('SELF_ARRANGED'),
    label: z.string(),
    available: z.boolean(),
    requiredFields: z.array(z.string()),
  }),
]);
export type ShipOption = z.infer<typeof shipOptionSchema>;

export const shipOptionsSchema = z.looseObject({
  tradeId: z.uuid(),
  tradeCode: z.string(),
  options: z.array(shipOptionSchema),
});
export type ShipOptions = z.infer<typeof shipOptionsSchema>;

/** X2: the ways this trade can be shipped. Seller only; 409 until the trade is `FUNDED` (the dispatch guard, X1). */
export const getShipOptions = defineEndpoint({
  method: 'get',
  path: '/trades/:id/ship-options',
  scope: 'CONSUMER',
  schema: { params: tradeParams, response: shipOptionsSchema },
});

/** What the seller must show to mark an item shipped with their own arrangement. All four are required. */
export const selfArrangedBodySchema = z.object({
  waybillNumber: z.string(),
  /** A finished PRIVATE_CASE image upload of the waybill receipt, the seller's own and used nowhere else. */
  receiptFileId: z.uuid(),
  driverPhone: z.string(),
  vehiclePlate: z.string(),
});
export type SelfArrangedBody = z.infer<typeof selfArrangedBodySchema>;

/** Marks the trade shipped and answers with it as it now stands. A replay by the same seller is harmless. */
export const shipSelfArranged = defineEndpoint({
  method: 'post',
  path: '/trades/:id/ship/self-arranged',
  scope: 'CONSUMER',
  retryable: true,
  schema: { params: tradeParams, body: selfArrangedBodySchema, response: tradeViewSchema },
});

/** The seller says the item arrived (SHIPPED only); the buyer is asked to confirm. Answers with the trade. */
export const reportDelivered = defineEndpoint({
  method: 'post',
  path: '/trades/:id/report-delivered',
  scope: 'CONSUMER',
  retryable: true,
  schema: { params: tradeParams, response: tradeViewSchema },
});

/** The buyer says they have it (SHIPPED or UNCONFIRMED_DELIVERY): inspection starts. Answers with the trade. */
export const confirmDelivery = defineEndpoint({
  method: 'post',
  path: '/trades/:id/confirm-delivery',
  scope: 'CONSUMER',
  retryable: true,
  schema: { params: tradeParams, response: tradeViewSchema },
});

/** DE1: why a seller is late. The platform's own list; a screen words each one. */
export const deliveryExtensionReasonSchema = z.enum([
  'COURIER_PICKUP_DELAYED',
  'RESTOCKING_ITEM',
  'ADDRESS_OR_LOGISTICS_ISSUE',
]);
export type DeliveryExtensionReason = z.infer<typeof deliveryExtensionReasonSchema>;

export const deliveryExtensionSchema = z.looseObject({
  id: z.uuid(),
  status: z.string(),
  reason: z.string().optional(),
  note: z.string().nullable().optional(),
  currentDueAt: z.string().optional(),
  requestedDueAt: z.string().optional(),
});
export type DeliveryExtension = z.infer<typeof deliveryExtensionSchema>;

/** DE1: the seller asks the buyer for more time before the deadline passes. Once per deadline. */
export const requestDeliveryExtension = defineEndpoint({
  method: 'post',
  path: '/trades/:id/delivery-extension',
  scope: 'CONSUMER',
  retryable: true,
  schema: {
    params: tradeParams,
    body: z.object({
      reason: deliveryExtensionReasonSchema,
      /** An ISO instant, later than the current deadline. */
      requestedDueAt: z.iso.datetime(),
      note: z.string().trim().min(1).max(500).optional(),
    }),
    response: deliveryExtensionSchema,
  },
});

const requestParams = z.object({ id: z.uuid(), requestId: z.uuid() });

/** DE2: the buyer agrees to the new date. */
export const acceptDeliveryExtension = defineEndpoint({
  method: 'post',
  path: '/trades/:id/delivery-extension/:requestId/accept',
  scope: 'CONSUMER',
  retryable: true,
  schema: { params: requestParams, response: deliveryExtensionSchema },
});

/** DE2: the buyer declines; the original date stands. */
export const declineDeliveryExtension = defineEndpoint({
  method: 'post',
  path: '/trades/:id/delivery-extension/:requestId/decline',
  scope: 'CONSUMER',
  retryable: true,
  schema: { params: requestParams, response: deliveryExtensionSchema },
});
