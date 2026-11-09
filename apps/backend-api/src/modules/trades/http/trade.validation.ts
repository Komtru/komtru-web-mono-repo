// Request and response shapes for T-061's `/trades` routes. Money is a digit string in kobo on the
// wire (a JSON number loses kobo past 2^53) and a bigint inside.
import { counterpartyDisplaySchema, koboJsonSchema, tradeCategoryFieldsSchema } from '@komtru/shared-types';
import { z } from 'zod';

export const tradeIdParamSchema = z.object({ id: z.uuid() });

const roleSchema = z.enum(['BUYER', 'SELLER']);
const koboInput = koboJsonSchema.transform((value) => BigInt(value));
const itemSpecSchema = z
  .record(z.string().min(1).max(60), z.unknown())
  .refine(
    (spec) => Object.keys(spec).length <= 40 && JSON.stringify(spec).length <= 8_000,
    'The item details are too large',
  );
const proofFileIdsSchema = z.array(z.uuid()).max(20);

export const previewBodySchema = z.object({
  role: roleSchema,
  categoryCode: z.string().min(1).max(60),
  itemAmountMinor: koboInput.optional(),
});

export const createTradeBodySchema = z.object({
  role: roleSchema,
  categoryCode: z.string().min(1).max(60),
  itemAmountMinor: koboInput,
  itemSpec: itemSpecSchema,
  /** The saved address for the initiator's own side: delivery for a buyer, ships-from for a seller. */
  addressId: z.uuid(),
  proofFileIds: proofFileIdsSchema.optional(),
});

/** Exactly one way of naming the counterparty. */
export const sendTradeBodySchema = z
  .object({
    username: z.string().min(1).max(40).optional(),
    email: z.string().min(3).max(254).optional(),
    phone: z.string().min(5).max(20).optional(),
    proofFileIds: proofFileIdsSchema.optional(),
  })
  .refine((body) => [body.username, body.email, body.phone].filter(Boolean).length === 1, {
    message: 'Name the other party by exactly one of username, email or phone',
    path: ['username'],
  });

export const counterBodySchema = z
  .object({
    expectedRevision: z.int().min(0),
    itemAmountMinor: koboInput.optional(),
    itemSpec: itemSpecSchema.optional(),
    addressId: z.uuid().optional(),
    proofFileIds: proofFileIdsSchema.optional(),
  })
  .refine(
    (body) =>
      body.itemAmountMinor !== undefined ||
      body.itemSpec !== undefined ||
      body.addressId !== undefined ||
      (body.proofFileIds?.length ?? 0) > 0,
    { message: 'Change at least one term', path: ['itemAmountMinor'] },
  );

export const acceptBodySchema = z.object({
  termsVersionId: z.uuid(),
  addressId: z.uuid().optional(),
  proofFileIds: proofFileIdsSchema.optional(),
});

export const declineBodySchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const cancelBodySchema = z.object({ reason: z.string().trim().min(1).max(500).optional() });

/** The trade view is built by the service; the contract pins the fields clients branch on. */
export const tradeViewSchema = z.looseObject({
  id: z.uuid(),
  tradeCode: z.string(),
  status: z.string(),
  statusRevision: z.number(),
  yourRole: roleSchema,
  ...tradeCategoryFieldsSchema.shape,
  /**
   * The other party, as the list shows them; null until bound and for an erased or closed account. Present on
   * the proposal routes (`GET /trades/:id` and the actions on a proposal); the fulfilment and inspection
   * actions return the view without it.
   */
  counterparty: counterpartyDisplaySchema.nullable().optional(),
});

export const previewResponseSchema = z.looseObject({
  allowedRoles: z.array(roleSchema),
});
