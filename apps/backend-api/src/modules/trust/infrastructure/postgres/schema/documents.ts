// M6 §6.6's first two tables: proof of address, and the documents every check hangs its evidence on.
//
// D5 governs both — this module stores a `storage_ref` (an M20 file id) and an outcome, never bytes.
// Module 0 provisioned the `kyc-documents` bucket for exactly this.
import { boolean, index, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { trust } from './columns.js';
import { addressMethod, kycProvider, verificationDocumentType } from './enums.js';
import { verificationRequests } from './requests.js';

export const addressChecks = trust.table(
  'address_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => verificationRequests.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    addressLine1: text('address_line1').notNull(),
    city: text('city').notNull(),
    state: text('state').notNull(),
    method: addressMethod('method').notNull(),
    /** Soft reference to files.file_records(id) (M20, D5). Null only for `PROVIDER_LOOKUP`. */
    documentRef: uuid('document_ref'),
    /**
     * Null means "nobody has decided yet", which is this table's normal state today.
     *
     * §6.6 gives `address_checks` no `provider` and no `provider_reference` — the only outcome table
     * in the section without them — so an address check here is evidence a person weighs, not a
     * provider verdict. It is written null and set by T-052's reviewer.
     */
    passed: boolean('passed'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('address_checks_user_idx').on(table.userId)],
);

export const verificationDocuments = trust.table(
  'verification_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => verificationRequests.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    documentType: verificationDocumentType('document_type').notNull(),
    /** The M20 file id. This module never holds the file (D5). */
    storageRef: uuid('storage_ref').notNull(),
    /** Null until something — a provider or a reviewer — has looked at it. */
    authenticityCheckPassed: boolean('authenticity_check_passed'),
    provider: kycProvider('provider'),
    providerReference: text('provider_reference'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (table) => [
    index('verification_documents_user_idx').on(table.userId),
    // Not in §6.6, and the one query a reviewer always runs: "show me this request's evidence".
    index('verification_documents_request_idx').on(table.requestId),
  ],
);

export type AddressCheck = typeof addressChecks.$inferSelect;
export type VerificationDocument = typeof verificationDocuments.$inferSelect;
