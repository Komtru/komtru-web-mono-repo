// M1 §9.1 as data. One table, so "can X become Y, and who may do it" is answered in one place and
// tested pair by pair. Everything not listed is refused: the machine is deny-by-default.
import type { PermissionCode } from './rbac/catalog.js';
import { sessionUsableUnder } from './session/status.js';

export const LIFECYCLE_STATUSES = [
  'PENDING_VERIFICATION',
  'ACTIVE',
  'RESTRICTED',
  'SUSPENDED',
  'LOCKED',
  'CLOSED',
  'ANONYMISED',
] as const;

export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

/** STAFF: an admin with a permission. SYSTEM: a job, a risk rule or a completed recovery. SELF: the account holder. */
export type Initiator = 'STAFF' | 'SYSTEM' | 'SELF';

const EDGES: Readonly<
  Record<LifecycleStatus, Readonly<Partial<Record<LifecycleStatus, readonly Initiator[]>>>>
> = {
  PENDING_VERIFICATION: {
    ACTIVE: ['SYSTEM'],
    CLOSED: ['SYSTEM', 'SELF'],
    SUSPENDED: ['SYSTEM'], // risk block at signup
  },
  ACTIVE: {
    RESTRICTED: ['STAFF', 'SYSTEM'],
    SUSPENDED: ['STAFF', 'SYSTEM'],
    LOCKED: ['SYSTEM'], // auto-lock is a risk action; there is no staff lock permission (M1 §12.2)
    CLOSED: ['SELF', 'STAFF'],
  },
  RESTRICTED: {
    ACTIVE: ['STAFF'],
    SUSPENDED: ['STAFF', 'SYSTEM'], // escalate
  },
  SUSPENDED: {
    ACTIVE: ['STAFF'],
    CLOSED: ['STAFF'], // escalate
  },
  LOCKED: {
    ACTIVE: ['STAFF', 'SYSTEM'], // self-recovery or an approved recovery request
  },
  CLOSED: {
    ANONYMISED: ['SYSTEM'], // the erasure procedure only
  },
  ANONYMISED: {},
};

export const transitionAllowed = (from: LifecycleStatus, to: LifecycleStatus, by: Initiator): boolean =>
  EDGES[from][to]?.includes(by) ?? false;

const STAFF_PERMISSION: Readonly<Partial<Record<LifecycleStatus, PermissionCode>>> = {
  RESTRICTED: 'user.restrict',
  SUSPENDED: 'user.suspend',
  ACTIVE: 'user.reinstate',
  CLOSED: 'user.close',
};

/** The permission staff need to move an account INTO `to`; undefined when staff cannot do it at all. */
export const staffPermissionFor = (to: LifecycleStatus): PermissionCode | undefined => STAFF_PERMISSION[to];

/** Whether an account in this status may hold a session. The one list lives in `session/status.ts`. */
export const isStatusUsable = (status: LifecycleStatus): boolean => sessionUsableUnder(status);

/** Days an abandoned registration, and a closed account awaiting erasure, are kept (M1 §9.1, §15). */
export const ABANDONED_REGISTRATION_DAYS = 30;
export const CLOSED_RETENTION_DAYS = 30;
