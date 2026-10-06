// What trust publishes (M6 §9), through the transactional outbox: a row written in the same
// transaction as the state change, so a rollback publishes nothing and a commit cannot lose it.
//
// The names carry a `trust.` prefix the spec's §9 table does not: the platform's event bus requires
// `<module>.<aggregate>.<action>` and refuses a two-segment name at import, and every existing
// module follows it (`identity.user.registered`, `files.file.uploaded`). The spec's own suffixes are
// kept verbatim after the prefix, so the mapping back to §9 is one to one.
//
// Every field here lands in `platform.outbox` and stays there, so each one is a deliberate choice.
// None of them carries an identifier, a name or a date of birth — D1 applies to the event stream
// exactly as it applies to the tables, and an outbox is the easiest place to forget that.
import { defineEvent } from '@komtru/shared-types';
import { z } from 'zod';
import { VERIFICATION_TYPES } from '../infrastructure/postgres/schema/enums.js';

const verificationType = z.enum(VERIFICATION_TYPES);

/** Consumed by Notifications: "we have your details, this usually takes a few minutes". */
export const verificationSubmitted = defineEvent(
  'trust.verification.submitted',
  1,
  z.object({ requestId: z.uuid(), userId: z.uuid(), type: verificationType }),
);

/**
 * Consumed by Identity (M1), Notifications and Audit.
 *
 * `provider` is on the payload, and it is the field that matters most right now: until real
 * credentials exist every grant says `FAKE`, and a consumer that cares — a risk rule, a compliance
 * export — should not have to join back to this module's tables to find that out.
 */
export const verificationLevelAttained = defineEvent(
  'trust.verification.level_attained',
  1,
  z.object({
    userId: z.uuid(),
    level: z.number().int().min(2).max(4),
    requestId: z.uuid().nullable(),
    provider: z.string().min(1),
  }),
);

/** Consumed by Identity (M1), Notifications, Risk (M13) and Tickets. */
export const verificationLevelRevoked = defineEvent(
  'trust.verification.level_revoked',
  1,
  z.object({
    userId: z.uuid(),
    fromLevel: z.number().int().min(0).max(4),
    toLevel: z.number().int().min(0).max(4),
    reason: z.string().min(1),
  }),
);

/**
 * Consumed by Notifications and, from T-100, by Tickets — M6 §9 auto-opens a support case when this
 * fires twice for one user inside 30 days, which is why `attemptCount` rides along rather than
 * making the consumer count rows in a schema it does not own.
 */
export const verificationRejected = defineEvent(
  'trust.verification.rejected',
  1,
  z.object({
    requestId: z.uuid(),
    userId: z.uuid(),
    type: verificationType,
    reason: z.string().min(1),
    attemptCount: z.number().int().min(0),
  }),
);

/**
 * Consumed by Risk (M13, high priority), Tickets and Audit — and, from T-052, by the duplicate flag
 * table and the KYC review queue that this ticket deliberately does not build.
 *
 * It carries the hash rather than the identifier, as hex: two accounts correlating to one number is
 * the fact a reviewer needs, and the number itself is not required to establish it (D1).
 */
export const verificationDuplicateIdentityDetected = defineEvent(
  'trust.verification.duplicate_identity_detected',
  1,
  z.object({
    identifierType: verificationType,
    identifierHashHex: z.string().min(1),
    firstUserId: z.uuid().nullable(),
    conflictingUserId: z.uuid(),
    requestId: z.uuid(),
  }),
);
