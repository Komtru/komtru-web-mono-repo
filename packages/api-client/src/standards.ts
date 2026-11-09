// Trade Standards by category (T-049), the public read behind CTS1 and behind the item form of a new
// trade. Mirrors `GET /config/trade-standards`, which is page-paged and public.
import { pagedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { defineEndpoint } from './contracts.js';
import { itemSpecFieldSchema, proofMediaRuleSchema } from './trades.js';

export const tradeStandardSchema = z.object({
  versionId: z.uuid(),
  categoryCode: z.string(),
  categoryName: z.string(),
  versionNumber: z.number(),
  createdAt: z.string(),
  inspectionWindowHours: z.number(),
  itemSpecFields: z.array(itemSpecFieldSchema),
  proofMedia: proofMediaRuleSchema,
  imeiVerification: z.boolean(),
  deliveryDeadlineDays: z.number(),
});
export type TradeStandard = z.infer<typeof tradeStandardSchema>;

export const listTradeStandards = defineEndpoint({
  method: 'get',
  path: '/config/trade-standards',
  scope: 'PUBLIC',
  paginated: 'page',
  schema: {
    query: z.object({ page: z.int().min(1).optional(), limit: z.int().min(1).max(100).optional() }),
    response: pagedSchema(tradeStandardSchema),
  },
});
