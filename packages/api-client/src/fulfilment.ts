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
