// The identity schema and the two column types drizzle has no builder for. Every identity table is
// declared on `identity`; nothing identity owns lives in public (design §4.2).
import { customType, pgSchema } from 'drizzle-orm/pg-core';

export const identity = pgSchema('identity');

/**
 * Case-insensitive text, from the citext extension in public (migration 0004). Used for usernames
 * and email addresses so uniqueness does not depend on every caller having remembered to lowercase.
 * Note that citext folds case in `~` too, which is why the username format CHECK casts to text.
 */
export const citext = customType<{ data: string; driverData: string }>({ dataType: () => 'citext' });

/** Raw bytes: token and OTP hashes, envelope-encrypted secrets, WebAuthn keys. Never plaintext. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
