// `passkey_credentials` and the row work around a WebAuthn verdict. Skipped unless
// KOMTRU_INFRA_TESTS=1.
//
// The verdict itself is supplied by a stub (`stubRelyingParty`): an assertion cannot be produced
// without an authenticator, and a hand-built one would be testing `@simplewebauthn/server` rather
// than this module. What is under test here is everything the library does NOT do — the credential
// row, the factor beside it, the sign counter, and the scoping that stops one account's key
// answering another account's challenge.
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  listPasskeys,
  revokePasskey,
  verifyPasskeyAssertion,
} from '../../../../src/modules/identity/services/passkey.service.js';
import {
  completePasskeyRegistration,
  passkeyRegistrationOptions,
  removeFactor,
  type MfaDeps,
} from '../../../../src/modules/identity/services/mfa.service.js';
import { passkeyCredentials } from '../../../../src/modules/identity/infrastructure/postgres/schema/sessions.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { mfaDeps, outboxEventTypes, seedUser, stubRelyingParty } from '../support.js';

const assertionFor = (credentialId: Buffer) => ({
  id: credentialId.toString('base64url'),
  response: {},
});

describe.runIf(infraEnabled)('passkey registration', () => {
  const t = useTestDatabase();

  it('parks the challenge under the ceremony key and excludes credentials already held', async () => {
    const webauthn = stubRelyingParty();
    const deps: MfaDeps = mfaDeps({ webauthn });
    const { userId } = await seedUser(t.app());

    const credentialId = randomBytes(16);
    await t
      .db()
      .insert(passkeyCredentials)
      .values({
        userId,
        credentialId,
        publicKey: randomBytes(64),
      });

    const options = await passkeyRegistrationOptions(t.db(), deps, {
      userId,
      userName: userId,
      displayName: 'Jane',
      ceremonyKey: 'session-1',
    });

    expect(options.excludeCredentials).toEqual([{ id: credentialId.toString('base64url'), transports: [] }]);
    // Parked, and single use.
    expect(await deps.webauthnChallenges.take('session-1')).toBe(options.challenge);
    expect(await deps.webauthnChallenges.take('session-1')).toBeNull();
  });

  it('stores the credential and a PASSKEY factor beside it', async () => {
    const deps: MfaDeps = mfaDeps();
    const { userId } = await seedUser(t.app());
    await deps.webauthnChallenges.put('session-1', 'the-challenge');

    const result = await completePasskeyRegistration(t.db(), deps, {
      userId,
      ceremonyKey: 'session-1',
      response: {},
      label: 'iPhone',
    });
    expect(result.outcome).toBe('ACTIVATED');

    const credentials = await t
      .db()
      .select()
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.userId, userId));
    expect(credentials).toHaveLength(1);
    expect(credentials[0]?.backedUp).toBe(true);
    expect(await outboxEventTypes(t.app())).toContain('identity.mfa.enrolled');
  });

  /**
   * A ceremony that proceeded without its challenge would verify a signature over a nonce nobody
   * issued, which is verifying nothing.
   */
  it('refuses a ceremony nobody began on this session', async () => {
    const deps: MfaDeps = mfaDeps();
    const { userId } = await seedUser(t.app());

    expect(
      (
        await completePasskeyRegistration(t.db(), deps, {
          userId,
          ceremonyKey: 'never-began',
          response: {},
          label: null,
        })
      ).outcome,
    ).toBe('REJECTED');
    expect(await t.db().select().from(passkeyCredentials)).toHaveLength(0);
  });

  /**
   * `passkey_credentials.credential_id` is UNIQUE across the whole table, which is what WebAuthn
   * requires. drizzle wraps the 23505 with the `pg` error on `cause`, so the obvious top-level
   * `error.code` read misses it and this would be a 500 instead of a clean answer.
   */
  it('answers ALREADY_REGISTERED for an authenticator some account already holds', async () => {
    const credentialId = randomBytes(16);
    const webauthn = stubRelyingParty({
      verifyRegistration: () =>
        Promise.resolve({
          credentialId,
          publicKey: randomBytes(64),
          counter: 0,
          aaguid: null,
          transports: [],
          backedUp: false,
        }),
    });
    const deps: MfaDeps = mfaDeps({ webauthn });

    const a = await seedUser(t.app());
    const b = await seedUser(t.app());
    await deps.webauthnChallenges.put('a', 'challenge');
    await deps.webauthnChallenges.put('b', 'challenge');

    expect(
      (
        await completePasskeyRegistration(t.db(), deps, {
          userId: a.userId,
          ceremonyKey: 'a',
          response: {},
          label: null,
        })
      ).outcome,
    ).toBe('ACTIVATED');

    expect(
      (
        await completePasskeyRegistration(t.db(), deps, {
          userId: b.userId,
          ceremonyKey: 'b',
          response: {},
          label: null,
        })
      ).outcome,
    ).toBe('ALREADY_REGISTERED');
  });
});

describe.runIf(infraEnabled)('passkey assertion', () => {
  const t = useTestDatabase();

  const seedCredential = async (userId: string, signCount = 0) => {
    const credentialId = randomBytes(16);
    await t
      .db()
      .insert(passkeyCredentials)
      .values({ userId, credentialId, publicKey: randomBytes(64), signCount });
    return credentialId;
  };

  it('advances the sign counter and records the use', async () => {
    const webauthn = stubRelyingParty({
      verifyAuthentication: () => Promise.resolve({ verified: true, newCounter: 9 }),
    });
    const deps: MfaDeps = mfaDeps({ webauthn });
    const { userId } = await seedUser(t.app());
    const credentialId = await seedCredential(userId, 4);
    await deps.webauthnChallenges.put('session-1', 'challenge');

    expect(
      await t.db().transaction((tx) =>
        verifyPasskeyAssertion(tx, deps, {
          userId,
          ceremonyKey: 'session-1',
          response: assertionFor(credentialId),
        }),
      ),
    ).toBe(true);

    const row = (
      await t.db().select().from(passkeyCredentials).where(eq(passkeyCredentials.userId, userId))
    )[0];
    expect(row?.signCount).toBe(9);
    expect(row?.lastUsedAt).not.toBeNull();
  });

  /**
   * WebAuthn's cloned-authenticator signal: a genuine authenticator only ever counts up, so a
   * counter that did not advance means two devices are answering for one credential.
   */
  it('refuses an assertion whose counter did not advance', async () => {
    const webauthn = stubRelyingParty({
      verifyAuthentication: () => Promise.resolve({ verified: true, newCounter: 4 }),
    });
    const deps: MfaDeps = mfaDeps({ webauthn });
    const { userId } = await seedUser(t.app());
    const credentialId = await seedCredential(userId, 4);
    await deps.webauthnChallenges.put('session-1', 'challenge');

    expect(
      await t.db().transaction((tx) =>
        verifyPasskeyAssertion(tx, deps, {
          userId,
          ceremonyKey: 'session-1',
          response: assertionFor(credentialId),
        }),
      ),
    ).toBe(false);
  });

  /** A stored 0 means the authenticator keeps no counter; most synced passkeys report exactly that. */
  it('accepts a counter that stays at zero', async () => {
    const webauthn = stubRelyingParty({
      verifyAuthentication: () => Promise.resolve({ verified: true, newCounter: 0 }),
    });
    const deps: MfaDeps = mfaDeps({ webauthn });
    const { userId } = await seedUser(t.app());
    const credentialId = await seedCredential(userId, 0);
    await deps.webauthnChallenges.put('session-1', 'challenge');

    expect(
      await t.db().transaction((tx) =>
        verifyPasskeyAssertion(tx, deps, {
          userId,
          ceremonyKey: 'session-1',
          response: assertionFor(credentialId),
        }),
      ),
    ).toBe(true);
  });

  /** A credential id travels in every assertion; a lookup that did not scope by user would be a hole. */
  it('refuses one account’s credential presented for another', async () => {
    const deps: MfaDeps = mfaDeps();
    const owner = await seedUser(t.app());
    const stranger = await seedUser(t.app());
    const credentialId = await seedCredential(owner.userId);
    await deps.webauthnChallenges.put('session-1', 'challenge');

    expect(
      await t.db().transaction((tx) =>
        verifyPasskeyAssertion(tx, deps, {
          userId: stranger.userId,
          ceremonyKey: 'session-1',
          response: assertionFor(credentialId),
        }),
      ),
    ).toBe(false);
  });

  it('refuses when no challenge was parked for this ceremony', async () => {
    const deps: MfaDeps = mfaDeps();
    const { userId } = await seedUser(t.app());
    const credentialId = await seedCredential(userId);

    expect(
      await t.db().transaction((tx) =>
        verifyPasskeyAssertion(tx, deps, {
          userId,
          ceremonyKey: 'never',
          response: assertionFor(credentialId),
        }),
      ),
    ).toBe(false);
  });

  /**
   * A revoked factor whose credential row survived would still answer an assertion, because the
   * assertion path looks the credential up directly rather than through the factor.
   */
  it('stops answering once the factor is removed', async () => {
    const deps: MfaDeps = mfaDeps();
    const { userId } = await seedUser(t.app());
    await deps.webauthnChallenges.put('session-1', 'challenge');
    const registered = await completePasskeyRegistration(t.db(), deps, {
      userId,
      ceremonyKey: 'session-1',
      response: {},
      label: null,
    });
    if (registered.outcome !== 'ACTIVATED') throw new Error('expected ACTIVATED');

    await t.db().transaction((tx) => removeFactor(tx, deps, { userId, factorId: registered.factorId }));

    expect(await t.db().transaction((tx) => listPasskeys(tx, userId))).toHaveLength(0);
  });

  it('revokes a credential only for its owner', async () => {
    const owner = await seedUser(t.app());
    const stranger = await seedUser(t.app());
    await seedCredential(owner.userId);
    const [row] = await t.db().select().from(passkeyCredentials);

    expect(
      await t
        .db()
        .transaction((tx) =>
          revokePasskey(tx, { userId: stranger.userId, credentialRowId: row?.id as string }),
        ),
    ).toBe(false);
    expect(
      await t
        .db()
        .transaction((tx) => revokePasskey(tx, { userId: owner.userId, credentialRowId: row?.id as string })),
    ).toBe(true);
  });
});
