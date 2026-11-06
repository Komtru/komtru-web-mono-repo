// What the location catalog publishes, through the transactional outbox. Three segments per event
// type, as the platform requires.
import { defineEvent } from '@komtru/shared-types';
import { z } from 'zod';

export const CATALOG_CHANGES = [
  'CITY_ADDED',
  'CITY_UPDATED',
  'CITY_DEACTIVATED',
  'CITY_ACTIVATED',
  /** The seed inserted rows; it names no single state or city. */
  'CATALOG_SEEDED',
] as const;

/** Anything a dropdown would show differently afterwards. This module's own cache subscribes to it. */
export const catalogChanged = defineEvent(
  'geo.catalog.changed',
  1,
  z.object({
    change: z.enum(CATALOG_CHANGES),
    stateId: z.uuid().nullable(),
    cityId: z.uuid().nullable(),
  }),
);

/**
 * A city request was decided. Notify binds it to the requester's notification; `cityName` is the
 * catalog city the request became or was folded into, null for a rejection.
 */
export const cityRequestDecided = defineEvent(
  'geo.city_request.decided',
  1,
  z.object({
    requestId: z.uuid(),
    requesterUserId: z.uuid(),
    status: z.enum(['ADDED', 'MERGED', 'REJECTED']),
    stateId: z.uuid(),
    stateName: z.string().min(1),
    requestedName: z.string().min(1),
    cityId: z.uuid().nullable(),
    cityName: z.string().nullable(),
    reason: z.string().nullable(),
  }),
);
