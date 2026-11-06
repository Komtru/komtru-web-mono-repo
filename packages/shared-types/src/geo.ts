// The location catalog's wire contracts (T-046, design 7.8): Nigeria's states, the cities that belong
// to them, and the "My city isn't listed" request. Shared by the backend routes and every app's
// dropdown, so a state or a city means the same thing on both sides.
import { z } from 'zod';
import { PAGE_LIMIT_MAX } from './pagination.js';

/**
 * What a typeahead or a uniqueness check compares: lower-case letters and digits, one space between
 * words. Accents, case, hyphens, apostrophes and doubled spaces all disappear, so `Port-Harcourt`,
 * `port  harcourt` and `PORT HARCOURT` are one city. Pure and idempotent.
 *
 * It never yields `%`, `_` or `\`, which is why the backend can put it in a LIKE prefix unescaped.
 */
export function normaliseCityName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** A dropdown loads in one request: the platform's largest cursor page. */
export const GEO_PAGE_LIMIT = PAGE_LIMIT_MAX;

/** What a person typed or staff entered: trimmed, with something searchable in it. */
export const cityNameSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(2)
      .max(80)
      .refine((value) => /\p{L}/u.test(value) && normaliseCityName(value).length >= 2, {
        message: 'Enter a city name',
      }),
  );

export const stateSchema = z.object({
  id: z.uuid(),
  /** ISO 3166-2:NG suffix: `LA` for Lagos, `FC` for the FCT. */
  code: z.string().regex(/^[A-Z]{2}$/),
  name: z.string().min(1),
});
export type State = z.infer<typeof stateSchema>;

export const citySchema = z.object({
  id: z.uuid(),
  stateId: z.uuid(),
  name: z.string().min(1),
  /** False for a city staff have taken out of the dropdowns; it stays readable by id. */
  active: z.boolean(),
});
export type City = z.infer<typeof citySchema>;

export const CITY_REQUEST_STATUSES = ['PENDING', 'ADDED', 'MERGED', 'REJECTED'] as const;
export const cityRequestStatusSchema = z.enum(CITY_REQUEST_STATUSES);
export type CityRequestStatus = z.infer<typeof cityRequestStatusSchema>;

export const cityRequestBodySchema = z.strictObject({
  stateId: z.uuid(),
  cityName: cityNameSchema,
});
export type CityRequestBody = z.infer<typeof cityRequestBodySchema>;

export const cityRequestSchema = z.object({
  id: z.uuid(),
  stateId: z.uuid(),
  cityName: z.string(),
  status: cityRequestStatusSchema,
  /** The catalog city the request ended up as, once `ADDED` or `MERGED`. */
  resolvedCityId: z.uuid().nullable(),
  decisionReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
});
export type CityRequest = z.infer<typeof cityRequestSchema>;
