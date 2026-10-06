// `identity.user_credentials`: setting a password, proving one, and the §S5 throttle around it.
//
// The whole of §S3 lives in `verifyAndRecord`. Its contract is one line and it is the one thing a
// reviewer should check: **exactly one password verification happens on every path**, including the
// paths where there is no password to verify. A nonexistent user, a social-only account and a
// throttled account all cost the same argon2 work as a wrong password, because skipping it would
// make the miss ~50ms faster and that difference is a working account-enumeration oracle.
import { eq, sql } from 'drizzle-orm';
import type { Tx } from '../../../platform/events/publish.js';
import type { Logger } from '../../../platform/logger.js';
import type { BreachDeps } from '../domain/credential/breach.js';
import { checkPasswordBreached } from '../domain/credential/breach.js';
import type { PasswordHasher } from '../domain/credential/hashing.js';
import { PASSWORD_ALGORITHM } from '../domain/credential/hashing.js';
import { lockedUntil } from '../domain/credential/lockout.js';
import {
  PASSWORD_REJECTION_MESSAGE,
  checkPasswordPolicy,
  type PasswordRejection,
} from '../domain/credential/policy.js';
import { userCredentials } from '../infrastructure/postgres/schema/credentials.js';

/** M1 §5.5's "last N hashes, to block reuse". N is this build's; the spec leaves it open. */
export const PASSWORD_HISTORY = 5;

export interface CredentialDeps {
  hasher: PasswordHasher;
  breach: BreachDeps;
  logger: Logger;
}

export type PasswordRefused = { ok: false; rejection: PasswordRejection; message: string };
export type SetPasswordResult = { ok: true } | PasswordRefused;

const refuse = (rejection: PasswordRejection): PasswordRefused => ({
  ok: false,
  rejection,
  message: PASSWORD_REJECTION_MESSAGE[rejection],
});

/**
 * §S2's gate, with no database and no transaction.
 *
 * Separate from `setPassword` for one reason that matters operationally: the breach check is an
 * HTTP call with a three-second timeout, and holding a Postgres transaction open across it would
 * park a connection — and whatever row locks it has taken — on a third party's availability. Every
 * caller runs this first, outside its transaction, and `setPassword` then only does the work that
 * genuinely needs the database.
 *
 * `identifiers` is whatever this account is known by — the email, the phone, the handle — so a
 * password that contains one is refused. No corpus catches `janedoe2026`; it is only weak for Jane.
 */
export async function validatePassword(
  deps: CredentialDeps,
  password: string,
  identifiers?: readonly string[],
): Promise<SetPasswordResult> {
  const verdict = checkPasswordPolicy(password, { ...(identifiers ? { identifiers } : {}) });
  if (!verdict.ok) return refuse(verdict.rejection ?? 'COMMON');

  const breach = await checkPasswordBreached(deps.breach, password);
  if (breach.breached) return refuse('BREACHED');
  if (breach.checkUnavailable) {
    // Not an error: breach.ts fails open on purpose, because an HIBP outage must not stop every
    // registration on the platform. The offline list in policy.ts is what is still in force.
    deps.logger.debug({}, 'identity: password accepted without a breach check; the corpus was unavailable');
  }
  return { ok: true };
}

export async function hasCredential(tx: Tx, userId: string): Promise<boolean> {
  const rows = await tx
    .select({ userId: userCredentials.userId })
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId))
    .limit(1);
  return rows.length > 0;
}

/**
 * Writes the password. Only the checks that need the database are here — `validatePassword` above
 * has already run the policy and the breach corpus, and the synchronous half of it runs again as a
 * backstop so a caller who forgot cannot write a three-character password.
 */
export async function setPassword(
  tx: Tx,
  deps: CredentialDeps,
  input: { userId: string; password: string; identifiers?: readonly string[] },
): Promise<SetPasswordResult> {
  const verdict = checkPasswordPolicy(input.password, {
    ...(input.identifiers ? { identifiers: input.identifiers } : {}),
  });
  if (!verdict.ok) return refuse(verdict.rejection ?? 'COMMON');

  const existing = (
    await tx
      .select({ passwordHash: userCredentials.passwordHash, previousHashes: userCredentials.previousHashes })
      .from(userCredentials)
      .where(eq(userCredentials.userId, input.userId))
      .for('update')
  )[0];

  if (!existing) {
    await tx.insert(userCredentials).values({
      userId: input.userId,
      passwordHash: await deps.hasher.hash(input.password),
      algorithm: PASSWORD_ALGORITHM,
    });
    return { ok: true };
  }

  // The current hash counts as history: "do not reuse the last five" has to include the one in
  // force, or the most obvious reuse of all is the one that is allowed.
  const history = [existing.passwordHash, ...existing.previousHashes].slice(0, PASSWORD_HISTORY);
  for (const old of history) {
    if (await deps.hasher.verify(input.password, old)) return refuse('REUSED');
  }

  await tx
    .update(userCredentials)
    .set({
      passwordHash: await deps.hasher.hash(input.password),
      algorithm: PASSWORD_ALGORITHM,
      previousHashes: history.slice(0, PASSWORD_HISTORY - 1),
      mustChange: false,
      // A new password clears the throttle: the holder has just proven something, and leaving a
      // lock in place after a successful reset is how a recovery flow strands its own user.
      failedAttempts: 0,
      lockedUntil: null,
      passwordSetAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(userCredentials.userId, input.userId));

  return { ok: true };
}

export type PasswordVerdict =
  | { outcome: 'OK'; rehashed: boolean }
  | { outcome: 'WRONG'; failedAttempts: number; lockedUntil: Date | null }
  | { outcome: 'LOCKED'; until: Date }
  /** No row in `user_credentials`: a social-only account, or a phone user who has not set one yet. */
  | { outcome: 'NO_CREDENTIAL' };

/**
 * Proves a password and records the attempt.
 *
 * `userId` may be null — that is how the caller says "no such user" without having to decide,
 * itself, to do the decoy work. Doing it here is what makes the §S3 guarantee structural rather
 * than a rule every call site has to remember.
 */
export async function verifyAndRecord(
  tx: Tx,
  deps: CredentialDeps,
  input: { userId: string | null; password: string },
): Promise<PasswordVerdict> {
  const credential = input.userId
    ? (
        await tx.select().from(userCredentials).where(eq(userCredentials.userId, input.userId)).for('update')
      )[0]
    : undefined;

  if (!credential) {
    await deps.hasher.decoy(input.password);
    return { outcome: 'NO_CREDENTIAL' };
  }

  const now = new Date();
  const locked = credential.lockedUntil !== null && credential.lockedUntil.getTime() > now.getTime();

  // The verification runs even while locked. Short-circuiting here would make a locked account
  // ~50ms faster to probe than a live one, which is precisely the distinction §S3 forbids — and the
  // result is discarded, so a correct password does not unlock anything early.
  const matched = await deps.hasher.verify(input.password, credential.passwordHash);

  if (locked) return { outcome: 'LOCKED', until: credential.lockedUntil as Date };

  if (!matched) {
    const failedAttempts = credential.failedAttempts + 1;
    const until = lockedUntil(failedAttempts, now);
    await tx
      .update(userCredentials)
      .set({ failedAttempts, lockedUntil: until, updatedAt: sql`now()` })
      // §S5 and M1 §9.1 are explicit: this is the self-clearing throttle. `users.status` is NOT
      // touched here — `LOCKED` there is a risk lock needing the §S7 recovery flow, and conflating
      // the two turns a mistyped password into a support ticket.
      .where(eq(userCredentials.userId, credential.userId));
    return { outcome: 'WRONG', failedAttempts, lockedUntil: until };
  }

  // §S1's transparent rehash: the parameters live in the PHC string, so raising the cost later
  // upgrades each account on its owner's next successful sign-in rather than invalidating anything.
  const rehashed = deps.hasher.needsRehash(credential.passwordHash);
  await tx
    .update(userCredentials)
    .set({
      ...(rehashed
        ? { passwordHash: await deps.hasher.hash(input.password), algorithm: PASSWORD_ALGORITHM }
        : {}),
      failedAttempts: 0,
      lockedUntil: null,
      updatedAt: sql`now()`,
    })
    .where(eq(userCredentials.userId, credential.userId));

  return { outcome: 'OK', rehashed };
}
