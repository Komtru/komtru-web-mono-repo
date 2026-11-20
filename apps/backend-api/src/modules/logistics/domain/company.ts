// A logistics company (m2 §3): a courier onboarded by Komtru staff, or Park, the one default company
// (design §7.1). Pure values only; the table is in infrastructure/postgres/schema.

export const COMPANY_STATUSES = ['ENABLED', 'DISABLED'] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

/**
 * Park's row, seeded by migration 0057 with a fixed id so Park's own tables (T-090 onwards) and the
 * ship-step list can name it without a lookup by name. At most one company is the default: a partial
 * unique index enforces it.
 */
export const PARK_COMPANY_ID = '7a3c0f00-0000-4000-8000-000000000001';
export const PARK_COMPANY_NAME = 'Komtru Park';

/** A company name as staff type it: trimmed, with inner runs of whitespace collapsed. */
export const normaliseCompanyName = (raw: string): string => raw.trim().replace(/\s+/g, ' ');
