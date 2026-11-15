import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { ChangeItem } from '../../../domain/application.js';
import { merchant } from './columns.js';
import { applicationStatus, businessType, documentType, eventActorType } from './enums.js';

/**
 * One application. The form fields are nullable because a DRAFT is a form half filled in; `submit`
 * is what refuses an incomplete one (422), not the column.
 *
 * `merchant_applications_one_live` is the rule "at most one live application per user", enforced
 * here and not only in the service: two tabs submitting at once cannot both win.
 */
export const merchantApplications = merchant.table(
  'merchant_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Soft reference to identity.users(id). */
    userId: uuid('user_id').notNull(),
    status: applicationStatus('status').notNull().default('DRAFT'),
    businessName: text('business_name'),
    businessType: businessType('business_type'),
    /** The street line of the registered address. State and city are the catalogue's (T-046). */
    addressLine: text('address_line'),
    stateId: uuid('state_id'),
    cityId: uuid('city_id'),
    /** Trade category codes: they decide which Trade Standards apply to this merchant. */
    categories: text('categories')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Public record, stored plainly and normalised, as trust stores it. */
    cacRcNumber: text('cac_rc_number'),
    /** Soft reference to ledger.payout_accounts(id): M8 owns the account, this only points at it. */
    payoutAccountId: uuid('payout_account_id'),
    /** What staff asked to be changed, while the application is CHANGES_REQUESTED. */
    changesRequested: jsonb('changes_requested')
      .$type<ChangeItem[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Soft reference to cases.cases(id): the case for the CURRENT submission. */
    caseId: uuid('case_id'),
    submissionCount: integer('submission_count').notNull().default(0),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('merchant_applications_one_live')
      .on(table.userId)
      .where(sql`${table.status} IN ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED')`),
    uniqueIndex('merchant_applications_case_unique')
      .on(table.caseId)
      .where(sql`${table.caseId} IS NOT NULL`),
    index('merchant_applications_user_idx').on(table.userId, table.createdAt),
    index('merchant_applications_status_idx').on(table.status, table.submittedAt),
    // Past DRAFT there is a case; a first-time DRAFT has none.
    check(
      'merchant_applications_case_after_draft',
      sql`${table.status} = 'DRAFT' OR ${table.caseId} IS NOT NULL`,
    ),
    check(
      'merchant_applications_submitted_count',
      sql`(${table.status} = 'DRAFT') = (${table.submissionCount} = 0)`,
    ),
  ],
);

/** One document per type per application. A replacement overwrites the row; the log keeps the history. */
export const merchantApplicationDocuments = merchant.table(
  'merchant_application_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => merchantApplications.id),
    docType: documentType('doc_type').notNull(),
    /** Soft reference to files.file_records(id): a KYC_DOCUMENT the applicant uploaded. */
    fileId: uuid('file_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('merchant_application_documents_type_unique').on(table.applicationId, table.docType),
  ],
);

/**
 * The status and decision log. Append-only (migration 0050). A staff decision is not a row without its
 * reason and its policy citation: the CHECK says so, so a code path that forgets cannot write one.
 */
export const merchantApplicationEvents = merchant.table(
  'merchant_application_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => merchantApplications.id),
    fromStatus: applicationStatus('from_status'),
    toStatus: applicationStatus('to_status').notNull(),
    actorType: eventActorType('actor_type').notNull(),
    actorUserId: uuid('actor_user_id'),
    reason: text('reason'),
    policyCitation: text('policy_citation'),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('merchant_application_events_application_idx').on(table.applicationId, table.createdAt),
    check(
      'merchant_application_events_staff_decision',
      sql`${table.actorType} <> 'STAFF'
          OR ${table.toStatus} NOT IN ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED')
          OR (length(btrim(coalesce(${table.reason}, ''))) > 0
              AND length(btrim(coalesce(${table.policyCitation}, ''))) > 0)`,
    ),
    check(
      'merchant_application_events_staff_actor',
      sql`(${table.actorType} = 'STAFF') = (${table.actorUserId} IS NOT NULL)
          OR ${table.actorType} = 'APPLICANT'`,
    ),
  ],
);

export type MerchantApplication = typeof merchantApplications.$inferSelect;
export type MerchantApplicationDocument = typeof merchantApplicationDocuments.$inferSelect;
export type MerchantApplicationEvent = typeof merchantApplicationEvents.$inferSelect;
