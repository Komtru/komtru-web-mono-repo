// What M1 §15 anonymisation (T-039) means for the duplicate flags (T-052).
//
// A flag holds the keyed hash of an identifier two accounts claimed, plus a reviewer's free-text
// notes. Once either account has been erased, the hash is a stable digest of a person's NIN, BVN or
// registration that outlives the person, so it goes; the notes ("same man, new phone") go with it.
// The flag row stays, with both user ids: the decision and who made it are the audit record.
//
// Driven by `identity.account.anonymised` (identity commits the erasure and publishes; trust owns
// its tables and scrubs them), so it is idempotent and safe to redeliver. A flag that is still OPEN
// stays decidable afterwards: clearing it reads the hash from the request's own row, not the flag.
import { eq, or, sql } from 'drizzle-orm';
import type { Tx } from '../../../../platform/events/publish.js';
import { duplicateIdentityFlags } from './schema/duplicate-flags.js';

/** The empty value rather than NULL: `identifier_hash` is NOT NULL, as identity does for its own hashes. */
const SCRUBBED = sql`decode('', 'hex')`;

export async function scrubErasedAccountFlags(tx: Tx, userId: string): Promise<number> {
  const rows = await tx
    .update(duplicateIdentityFlags)
    .set({ identifierHash: SCRUBBED, resolutionNotes: null })
    .where(
      or(
        eq(duplicateIdentityFlags.firstUserId, userId),
        eq(duplicateIdentityFlags.conflictingUserId, userId),
      ),
    )
    .returning({ id: duplicateIdentityFlags.id });
  return rows.length;
}
