// What files publishes (M20 §7), through the transactional outbox: a row written in the same
// transaction as the state change, so a rollback publishes nothing and a commit cannot lose it.
//
// Three are domain events every consuming module and M15 care about. The other two are ops alerting,
// and they are the ones that matter operationally: a TRADE_ASSET account crossing its quota threshold
// is the signal that somebody must provision a sixth account before uploads start failing closed (D6).
import { defineEvent } from '@komtru/shared-types';
import { z } from 'zod';
import {
  FILE_CATEGORIES,
  FILE_VISIBILITIES,
  STORAGE_POOLS,
} from '../infrastructure/postgres/schema/enums.js';

const category = z.enum(FILE_CATEGORIES);
const visibility = z.enum(FILE_VISIBILITIES);
const pool = z.enum(STORAGE_POOLS);

/** Consumed by Audit (M15). Published on the transition to READY, never when the ticket is issued. */
export const fileUploaded = defineEvent(
  'files.file.uploaded',
  1,
  z.object({
    fileId: z.uuid(),
    category,
    visibility,
    uploaderUserId: z.uuid(),
    owningModule: z.string().min(1),
    sizeBytes: z.number().int().min(0),
  }),
);

/** Exactly one of the two grantee fields is set, but both are stated, so neither is silently absent. */
export const fileAccessGranted = defineEvent(
  'files.file.access_granted',
  1,
  z.object({
    fileId: z.uuid(),
    granteeUserId: z.uuid().nullable(),
    granteeRole: z.string().min(1).nullable(),
    reason: z.string().min(1),
  }),
);

/** Consumed by Audit and by every module holding a soft `file_ref_id`, to invalidate a cached URL. */
export const fileTombstoned = defineEvent(
  'files.file.tombstoned',
  1,
  z.object({
    fileId: z.uuid(),
    category,
    reason: z.string().min(1),
    /** Null for an M15-driven retention sweep, which has no human actor. */
    actorUserId: z.uuid().nullable(),
  }),
);

const accountAlert = {
  accountId: z.uuid(),
  /** `trade-2`, not a uuid: what an operator matches against the Cloudinary console. */
  label: z.string().min(1),
  pool,
  creditsUsedPct: z.number().min(0).max(100),
};

/** Emitted only on a transition, so ops gets one alert per crossing rather than one an hour forever. */
export const storageAccountNearQuota = defineEvent(
  'files.storage_account.near_quota',
  1,
  z.object(accountAlert),
);

/** Uploads to this account's pool are now failing closed. A page, not a dashboard tile. */
export const storageAccountDisabled = defineEvent(
  'files.storage_account.disabled',
  1,
  z.object({ ...accountAlert, reason: z.string().min(1) }),
);

/** In M20 §7's order; the test asserts over this so a new event cannot be added unannounced. */
export const FILE_EVENTS = [
  fileUploaded,
  fileAccessGranted,
  fileTombstoned,
  storageAccountNearQuota,
  storageAccountDisabled,
] as const;
