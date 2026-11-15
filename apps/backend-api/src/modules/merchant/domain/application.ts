// What an application is made of (design 6.3, Q13) and what makes it complete. Pure.
export const BUSINESS_TYPES = ['INDIVIDUAL', 'REGISTERED_BUSINESS'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

/** The four documents the form takes. CAC documents are mandatory; the proprietor ID is part of the form. */
export const DOCUMENT_TYPES = ['CAC_CERTIFICATE', 'STATUS_REPORT', 'MEMORANDUM', 'DIRECTOR_ID'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface ApplicationForm {
  businessName: string;
  businessType: BusinessType;
  addressLine: string;
  stateId: string;
  cityId: string;
  categories: string[];
  cacRcNumber: string;
  /** A soft reference to the applicant's own `ledger.payout_accounts` row: M8 owns the account. */
  payoutAccountId: string;
}

/** In the order the form asks for them, so the 422 lists them the way a person fills it in. */
export const FORM_FIELDS = [
  'businessName',
  'businessType',
  'addressLine',
  'stateId',
  'cityId',
  'categories',
  'cacRcNumber',
  'payoutAccountId',
] as const satisfies readonly (keyof ApplicationForm)[];
export type FormField = (typeof FORM_FIELDS)[number];

export const missingFields = (form: Partial<ApplicationForm>): FormField[] =>
  FORM_FIELDS.filter((field) => {
    const value = form[field];
    if (value === undefined || value === null) return true;
    if (Array.isArray(value)) return value.length === 0;
    return typeof value === 'string' && value.trim().length === 0;
  });

/** The CAC pair: the certificate, and either the status report or the memorandum. */
export const cacDocumentsPresent = (present: readonly DocumentType[]): boolean =>
  present.includes('CAC_CERTIFICATE') &&
  (present.includes('STATUS_REPORT') || present.includes('MEMORANDUM'));

export type MissingDocument = 'CAC_CERTIFICATE' | 'STATUS_REPORT_OR_MEMORANDUM' | 'DIRECTOR_ID';

export const missingDocuments = (present: readonly DocumentType[]): MissingDocument[] => {
  const missing: MissingDocument[] = [];
  if (!present.includes('CAC_CERTIFICATE')) missing.push('CAC_CERTIFICATE');
  if (!present.includes('STATUS_REPORT') && !present.includes('MEMORANDUM')) {
    missing.push('STATUS_REPORT_OR_MEMORANDUM');
  }
  if (!present.includes('DIRECTOR_ID')) missing.push('DIRECTOR_ID');
  return missing;
};

export type ChangeItem =
  | { kind: 'DOCUMENT'; key: string; note?: string | undefined }
  | { kind: 'FIELD'; key: string; note?: string | undefined };

/** "Request changes (named documents or fields)": at least one, and each one a thing the form has. */
export function validateChangeItems(
  items: readonly ChangeItem[],
): { ok: true } | { ok: false; reason: string } {
  if (items.length === 0) return { ok: false, reason: 'Name at least one document or field to change' };
  for (const item of items) {
    const known: readonly string[] = item.kind === 'DOCUMENT' ? DOCUMENT_TYPES : FORM_FIELDS;
    if (!known.includes(item.key)) {
      return {
        ok: false,
        reason: `${item.key} is not a ${item.kind === 'DOCUMENT' ? 'document' : 'field'} on the form`,
      };
    }
  }
  return { ok: true };
}
