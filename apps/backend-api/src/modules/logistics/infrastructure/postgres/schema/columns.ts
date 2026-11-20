// The logistics schema (T-085, m2 §3) and the one column type drizzle has no builder for. Every
// logistics table lives here; a pointer to identity or trades is a soft uuid, never a REFERENCES.
import { customType, pgSchema } from 'drizzle-orm/pg-core';

export const logistics = pgSchema('logistics');

/** Raw bytes: the invitation lookup hash and the sealed contact. Never plaintext. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
