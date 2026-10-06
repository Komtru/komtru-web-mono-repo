// `identity.passkey_credentials` and the two WebAuthn ceremonies over it.
//
// This file owns the CREDENTIAL and nothing else: it imports no other service, so the factor row
// that wraps a passkey (mfa.service.ts) can call in without a cycle. Registration ends here with a
// stored credential; turning that into an `mfa_factors` row is the factor layer's job, because that
// is where "is this the first factor" and "does it become the default" are answered for all four
// kinds at once.
import { and, eq, isNull, sql } from 'drizzle-orm';
import { isUniqueViolation } from '../../../db/errors.js';
import type { Tx } from '../../../platform/events/publish.js';
import type { Logger } from '../../../platform/logger.js';
import { passkeyCredentials } from '../infrastructure/postgres/schema/sessions.js';
import type { RelyingParty } from '../infrastructure/webauthn/relying-party.js';
import type { WebauthnChallengeStore } from '../infrastructure/redis/webauthn-challenge.js';

/** The slice of `MfaDeps` this file needs. Narrow on purpose: it cannot reach a factor row. */
export interface PasskeyDeps {
  webauthn: RelyingParty;
  webauthnChallenges: WebauthnChallengeStore;
  logger: Logger;
}

export interface PasskeyRow {
  id: string;
  credentialId: Buffer;
  publicKey: Buffer;
  signCount: number;
  transports: string[];
  label: string | null;
}

const liveCredentials = (userId: string) =>
  and(eq(passkeyCredentials.userId, userId), isNull(passkeyCredentials.revokedAt));

export async function listPasskeys(tx: Tx, userId: string): Promise<PasskeyRow[]> {
  return tx
    .select({
      id: passkeyCredentials.id,
      credentialId: passkeyCredentials.credentialId,
      publicKey: passkeyCredentials.publicKey,
      signCount: passkeyCredentials.signCount,
      transports: passkeyCredentials.transports,
      label: passkeyCredentials.label,
    })
    .from(passkeyCredentials)
    .where(liveCredentials(userId));
}

const descriptor = (row: PasskeyRow) => ({
  id: Buffer.from(row.credentialId).toString('base64url'),
  transports: row.transports,
});

/**
 * `navigator.credentials.create()` options, with the challenge parked under the ceremony key.
 *
 * `excludeCredentials` is what stops the browser silently re-registering a key the account already
 * holds, which would otherwise look to the user like a successful enrolment that changed nothing.
 */
export async function beginPasskeyRegistration(
  tx: Tx,
  deps: PasskeyDeps,
  input: { userId: string; userName: string; displayName: string; ceremonyKey: string },
): Promise<Record<string, unknown>> {
  const existing = await listPasskeys(tx, input.userId);
  const options = await deps.webauthn.registrationOptions({
    userId: input.userId,
    userName: input.userName,
    displayName: input.displayName,
    exclude: existing.map(descriptor),
  });

  await deps.webauthnChallenges.put(input.ceremonyKey, options.challenge as string);
  return options;
}

export type StoredCredential =
  | { outcome: 'STORED'; credentialRowId: string; label: string | null }
  | { outcome: 'REJECTED' }
  /** The same authenticator, already on some account. The unique index is the authority. */
  | { outcome: 'ALREADY_REGISTERED' };

export async function storePasskeyCredential(
  tx: Tx,
  deps: PasskeyDeps,
  input: { userId: string; ceremonyKey: string; response: unknown; label: string | null },
): Promise<StoredCredential> {
  const challenge = await deps.webauthnChallenges.take(input.ceremonyKey);
  // No challenge means the ceremony expired, was already completed, or was never begun on this
  // session. All three are the same answer, and none of them may be allowed to proceed: verifying
  // a signature over a nonce nobody issued is verifying nothing.
  if (!challenge) return { outcome: 'REJECTED' };

  const verified = await deps.webauthn.verifyRegistration({
    response: input.response,
    expectedChallenge: challenge,
  });
  if (!verified) return { outcome: 'REJECTED' };

  try {
    // A SAVEPOINT, because a live 23505 aborts the whole Postgres transaction and the caller's
    // "already registered" answer would then arrive on a COMMIT that is silently a ROLLBACK.
    const row = await tx.transaction(async (sp) => {
      const inserted = await sp
        .insert(passkeyCredentials)
        .values({
          userId: input.userId,
          credentialId: verified.credentialId,
          publicKey: verified.publicKey,
          signCount: verified.counter,
          aaguid: verified.aaguid,
          transports: verified.transports,
          backedUp: verified.backedUp,
          label: input.label,
        })
        .returning({ id: passkeyCredentials.id });
      return inserted[0];
    });
    if (!row) throw new Error('storePasskeyCredential: the insert returned no row');
    return { outcome: 'STORED', credentialRowId: row.id, label: input.label };
  } catch (error) {
    // `passkey_credentials.credential_id` is UNIQUE across the whole table, not per user, which is
    // what WebAuthn requires: one authenticator credential belongs to one account. drizzle wraps
    // the driver error with the `pg` one on `cause`, so `error.code` at the top level is undefined
    // and the obvious catch misses every 23505 (src/db/errors.ts).
    if (isUniqueViolation(error, 'passkey_credentials_credential_id')) {
      return { outcome: 'ALREADY_REGISTERED' };
    }
    throw error;
  }
}

/** `navigator.credentials.get()` options, restricted to this account's own credentials. */
export async function passkeyAssertionOptions(
  tx: Tx,
  deps: PasskeyDeps,
  input: { userId: string; ceremonyKey: string },
): Promise<Record<string, unknown>> {
  const existing = await listPasskeys(tx, input.userId);
  const options = await deps.webauthn.authenticationOptions({ allow: existing.map(descriptor) });
  await deps.webauthnChallenges.put(input.ceremonyKey, options.challenge as string);
  return options;
}

/** The shape a browser's `startAuthentication()` hands back; only `id` is read here. */
const credentialIdOf = (response: unknown): string | null => {
  if (typeof response !== 'object' || response === null) return null;
  const id = (response as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

export async function verifyPasskeyAssertion(
  tx: Tx,
  deps: PasskeyDeps,
  input: { userId: string; ceremonyKey: string; response: unknown },
): Promise<boolean> {
  const challenge = await deps.webauthnChallenges.take(input.ceremonyKey);
  if (!challenge) return false;

  const presentedId = credentialIdOf(input.response);
  if (!presentedId) return false;

  // Scoped to the caller: a credential id is a public value that travels in every assertion, and a
  // lookup that did not say `user_id` would let one account's key answer another account's
  // challenge.
  const row = (
    await tx
      .select({
        id: passkeyCredentials.id,
        credentialId: passkeyCredentials.credentialId,
        publicKey: passkeyCredentials.publicKey,
        signCount: passkeyCredentials.signCount,
        transports: passkeyCredentials.transports,
      })
      .from(passkeyCredentials)
      .where(
        and(
          liveCredentials(input.userId),
          eq(passkeyCredentials.credentialId, Buffer.from(presentedId, 'base64url')),
        ),
      )
      .for('update')
  )[0];
  if (!row) return false;

  const verified = await deps.webauthn.verifyAuthentication({
    response: input.response,
    expectedChallenge: challenge,
    credential: {
      id: Buffer.from(row.credentialId).toString('base64url'),
      publicKey: Buffer.from(row.publicKey),
      counter: row.signCount,
      transports: row.transports,
    },
  });
  if (!verified.verified) return false;

  // The signature counter is WebAuthn's cloned-authenticator signal: a genuine authenticator only
  // ever counts up, so a counter that did not advance means two devices are answering for one
  // credential. A stored 0 means this authenticator keeps no counter at all (every passkey synced
  // through a platform keychain reports 0), and refusing those would refuse most of the market.
  if (row.signCount > 0 && verified.newCounter <= row.signCount) {
    deps.logger.error(
      { credentialRowId: row.id, stored: row.signCount, presented: verified.newCounter },
      'identity: a passkey signature counter did not advance — possible cloned authenticator',
    );
    return false;
  }

  await tx
    .update(passkeyCredentials)
    .set({ signCount: verified.newCounter, lastUsedAt: sql`now()` })
    .where(eq(passkeyCredentials.id, row.id));

  return true;
}

/** Revokes the credential behind a factor. Scoped to its owner, so another user's id is a miss. */
export async function revokePasskey(
  tx: Tx,
  input: { userId: string; credentialRowId: string },
): Promise<boolean> {
  const revoked = await tx
    .update(passkeyCredentials)
    .set({ revokedAt: sql`now()` })
    .where(and(liveCredentials(input.userId), eq(passkeyCredentials.id, input.credentialRowId)))
    .returning({ id: passkeyCredentials.id });
  return revoked.length > 0;
}
