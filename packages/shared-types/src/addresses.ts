// Saved delivery addresses (T-042): what a buyer keeps on their account and picks from at checkout.
// Shared by the backend routes and every app's address form, so a field means the same thing on both
// sides.
//
// `recipientPhone` is whatever the person typed on the way in (the backend normalises it to E.164 and
// rejects what it cannot parse) and always E.164 on the way out.
import { z } from 'zod';

/**
 * Live (non-archived) addresses one account may keep. Archived ones do not count: they exist only
 * because trades snapshot them, and a cap that counted them would punish people for tidying up.
 */
export const MAX_ADDRESSES_PER_USER = 20;

export const ADDRESS_LABEL_MAX = 40;
export const ADDRESS_RECIPIENT_MAX = 100;
export const ADDRESS_STREET_MAX = 200;
export const ADDRESS_LANDMARK_MAX = 200;

const text = (max: number) => z.string().trim().min(1).max(max);

/** A landmark is optional: absent, blank and null all mean "none", and are stored as null. */
const landmark = z
  .string()
  .trim()
  .max(ADDRESS_LANDMARK_MAX)
  .nullable()
  .transform((value) => (value === null || value === '' ? null : value));

const fields = {
  label: text(ADDRESS_LABEL_MAX),
  recipientName: text(ADDRESS_RECIPIENT_MAX),
  recipientPhone: z.string().trim().min(7).max(20),
  streetLine: text(ADDRESS_STREET_MAX),
  stateId: z.uuid(),
  cityId: z.uuid(),
};

export const createAddressBodySchema = z.strictObject({
  ...fields,
  landmark: landmark.optional().transform((value) => value ?? null),
  /** Makes this the default address. The first address becomes the default whatever this says. */
  makeDefault: z.boolean().optional(),
});
export type CreateAddressBody = z.infer<typeof createAddressBodySchema>;

export const updateAddressBodySchema = z
  .strictObject({
    label: fields.label.optional(),
    recipientName: fields.recipientName.optional(),
    recipientPhone: fields.recipientPhone.optional(),
    streetLine: fields.streetLine.optional(),
    landmark: landmark.optional(),
    stateId: fields.stateId.optional(),
    cityId: fields.cityId.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Send at least one field to change',
  });
export type UpdateAddressBody = z.infer<typeof updateAddressBodySchema>;

export const addressSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  recipientName: z.string(),
  recipientPhone: z.string(),
  streetLine: z.string(),
  landmark: z.string().nullable(),
  stateId: z.uuid(),
  stateName: z.string(),
  cityId: z.uuid(),
  cityName: z.string(),
  /** False when staff have since taken the city out of the catalog: the address cannot take a new trade. */
  cityActive: z.boolean(),
  isDefault: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Address = z.infer<typeof addressSchema>;
