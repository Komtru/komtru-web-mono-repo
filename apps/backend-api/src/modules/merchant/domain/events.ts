// What the merchant module publishes, through the transactional outbox, in the transaction that made it
// true. Names carry the module prefix the platform's bus requires (`<module>.<aggregate>.<action>`), so
// the AC's `merchant.certified` is `merchant.profile.certified` and `merchant.certification_revoked` is
// `merchant.profile.certification_revoked`: the suffixes are kept verbatim, as trust does.
//
// Nothing here carries a document, an address, a bank detail or a staff-written reason beyond what the
// applicant is shown. The reason on a decision is staff copy shown to the applicant as written (the
// geo city request does the same), so it travels on the decided event and nowhere else.
import { defineEvent } from '@komtru/shared-types';
import { z } from 'zod';
import { MERCHANT_APPLICATION_STATUSES } from './status.js';

export const merchantApplicationSubmitted = defineEvent(
  'merchant.application.submitted',
  1,
  z.object({
    applicationId: z.uuid(),
    userId: z.uuid(),
    caseId: z.uuid(),
    submission: z.number().int().min(1),
  }),
);

/** Consumed by Notifications (the applicant is told) and Audit. */
export const merchantApplicationDecided = defineEvent(
  'merchant.application.decided',
  1,
  z.object({
    applicationId: z.uuid(),
    userId: z.uuid(),
    outcome: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REJECTED']),
    status: z.enum(MERCHANT_APPLICATION_STATUSES),
    /** Staff copy, shown to the applicant as written. */
    reason: z.string().min(1),
    /** The documents and fields named on a changes-requested decision; empty otherwise. */
    requested: z.array(z.object({ kind: z.enum(['DOCUMENT', 'FIELD']), key: z.string() })),
    decidedByUserId: z.uuid(),
  }),
);

/** Consumed by Search (M19), Notifications and Audit: the account is now a certified merchant. */
export const merchantCertified = defineEvent(
  'merchant.profile.certified',
  1,
  z.object({
    userId: z.uuid(),
    applicationId: z.uuid(),
    storefrontSlug: z.string().min(1),
    certifiedAt: z.iso.datetime(),
  }),
);

/** Suspension or revocation. Consumed by listings (pause), Search and Notifications. */
export const merchantCertificationRevoked = defineEvent(
  'merchant.profile.certification_revoked',
  1,
  z.object({
    userId: z.uuid(),
    kind: z.enum(['SUSPENDED', 'REVOKED']),
    reason: z.string().min(1),
    revokedByUserId: z.uuid().nullable(),
  }),
);
