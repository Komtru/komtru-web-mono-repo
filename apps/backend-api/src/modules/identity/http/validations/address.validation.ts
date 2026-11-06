// Request and response shapes for T-042's `/me/addresses` lines. The bodies and the address itself are
// the shared contracts, so the apps' forms and this API cannot drift.
import {
  addressSchema,
  createAddressBodySchema,
  cursorPageRequestSchema,
  paginatedSchema,
  updateAddressBodySchema,
} from '@komtru/shared-types';
import { z } from 'zod';

export const addressIdParamSchema = z.object({ id: z.uuid() });
export const listAddressesQuerySchema = cursorPageRequestSchema;
export { createAddressBodySchema, updateAddressBodySchema };
export const addressResponseSchema = addressSchema;
export const addressListResponseSchema = paginatedSchema(addressSchema);
