// The one write path for `users.verification_level` above level 1.
//
// M1 §2 splits ownership: identity computes levels 0 and 1 from its own channel verification, and
// M6 computes 2 to 4. M6 §3 D6 has identity SUBSCRIBE to `verification.level_attained` to perform
// the write — this does it in the caller's transaction instead, and the reason is worth stating
// because it is a deliberate deviation:
//
//   the outbox relay makes a subscription eventually consistent, so `GET /verification/status`
//   would answer with the user's OLD level for as long as the relay is behind — which, on the one
//   screen whose entire purpose is to say "you are verified now", is the wrong answer at exactly
//   the wrong moment.
//
// The boundary D6 actually protects is preserved: identity still computes nothing. It is handed a
// level that M6 decided, and it performs the write and publishes the event. The write lands in the
// same transaction as M6's append-only `verification_level_changes` row, so the log and the column
// cannot disagree — which a subscription cannot promise either.
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { identityVerificationLevelChangedEvent } from '../domain/events.js';
import { users } from '../infrastructure/postgres/schema/users.js';
import { VERIFICATION_LEVELS, type VerificationLevelName } from '../infrastructure/postgres/schema/enums.js';

export interface ApplyVerificationLevelInput {
  userId: string;
  to: VerificationLevelName;
  reason: string;
}

export interface ApplyVerificationLevelResult {
  from: VerificationLevelName;
  to: VerificationLevelName;
  changed: boolean;
}

/**
 * Moves `users.verification_level` to `to`, or does nothing if it is already there.
 *
 * Idempotent on purpose: a redelivered job must not publish a second "you were verified" event, and
 * the level log above this must not grow a row saying a user moved from 2 to 2.
 */
export async function applyVerificationLevel(
  tx: Tx,
  input: ApplyVerificationLevelInput,
): Promise<ApplyVerificationLevelResult> {
  const [row] = await tx
    .select({ verificationLevel: users.verificationLevel })
    .from(users)
    .where(eq(users.id, input.userId))
    .for('update')
    .limit(1);

  if (!row) throw new Error(`identity: no user ${input.userId} to set a verification level on`);
  const from = row.verificationLevel;
  if (from === input.to) return { from, to: input.to, changed: false };

  if (!VERIFICATION_LEVELS.includes(input.to)) {
    throw new RangeError(`identity: "${input.to}" is not a verification level`);
  }

  await tx
    .update(users)
    .set({
      verificationLevel: input.to,
      // The database clock, not the process's: this timestamp is read back by M6's status endpoint
      // and by compliance exports, and two API instances with drifting clocks would order them wrong.
      verificationSyncedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, input.userId));

  await publish(tx, identityVerificationLevelChangedEvent, {
    payload: { userId: input.userId, from, to: input.to },
    aggregateType: 'user',
    aggregateId: input.userId,
  });

  return { from, to: input.to, changed: true };
}
