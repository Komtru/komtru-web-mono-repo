// Schemas for the catalog's routes. `reason` is optional in the schemas ON PURPOSE, as in config's and
// identity's admin schemas: a schema failure is a 422, and the admin surface answers a missing reason
// with a 400, so the controller owns that check.
import {
  cityNameSchema,
  cityRequestSchema,
  cityRequestStatusSchema,
  citySchema,
  paginatedSchema,
  stateSchema,
} from '@komtru/shared-types';
import { z } from 'zod';
import { MAX_ALIASES } from '../domain/catalog.js';

export const stateParams = z.object({ stateId: z.uuid() });
export const cityParams = z.object({ cityId: z.uuid() });
export const idParams = z.object({ id: z.uuid() });

export const searchQuery = z.object({
  q: z.string().max(80).optional(),
  stateId: z.uuid().optional(),
});

export const adminCitiesQuery = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export const requestQueueQuery = z.object({
  status: cityRequestStatusSchema.optional(),
  stateId: z.uuid().optional(),
});

const reason = z.string().max(1000).optional();
const aliases = z.array(z.string().min(1).max(80)).max(MAX_ALIASES);

export const addCityBody = z.strictObject({
  stateId: z.uuid(),
  name: cityNameSchema,
  aliases: aliases.optional(),
  reason,
});

export const updateCityBody = z
  .strictObject({ name: cityNameSchema.optional(), aliases: aliases.optional(), reason })
  .refine((body) => body.name !== undefined || body.aliases !== undefined, {
    message: 'Change the name, the aliases, or both',
  });

export const reasonBody = z.strictObject({ reason });

export const addRequestBody = z.strictObject({
  name: cityNameSchema.optional(),
  aliases: aliases.optional(),
  reason,
});

export const mergeRequestBody = z.strictObject({
  cityId: z.uuid(),
  addAlias: z.boolean().optional(),
  reason,
});

export const stateListResponse = paginatedSchema(stateSchema);
export const cityListResponse = paginatedSchema(citySchema);
export const searchResponse = paginatedSchema(citySchema.extend({ stateName: z.string() }));
export const cityWithStateResponse = citySchema.extend({ stateName: z.string() });
export const cityRequestResponse = cityRequestSchema;

const adminCity = citySchema.extend({
  aliases: z.array(z.string()),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export const adminCityResponse = adminCity;
export const adminCityListResponse = paginatedSchema(adminCity);
export const adminStateListResponse = paginatedSchema(
  stateSchema.extend({ cityCount: z.int().min(0), activeCityCount: z.int().min(0) }),
);
export const adminRequestListResponse = paginatedSchema(
  cityRequestSchema.extend({
    requestedByUserId: z.uuid(),
    stateName: z.string(),
    requesterCount: z.int().min(0),
  }),
);

export const submitRequestBody = z.strictObject({
  stateId: z.uuid(),
  cityName: cityNameSchema,
});
