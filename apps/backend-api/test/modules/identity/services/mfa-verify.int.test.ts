// Presenting a factor, and taking one away. Skipped unless KOMTRU_INFRA_TESTS=1.
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  activateTotp,
  enrolTotp,
  findOwnFactor,
  regenerateRecoveryCodes,
  removeFactor,
  verifyFactor,
  type FactorRow,
  type MfaDeps,
} from '../../../../src/modules/identity/services/mfa.service.js';
import { totpCodeAt, totpStep } from '../../../../src/modules/identity/domain/mfa/totp.js';
import { mfaFactors } from '../../../../src/modules/identity/infrastructure/postgres/schema/sessions.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { grantRole, mfaDeps, seedUser } from '../support.js';

const codeNow = (secret: string): string => totpCodeAt(secret, totpStep(Date.now()));

describe.runIf(infraEnabled)('verifyFactor', () => {
  const t = useTestDatabase();
  const deps: MfaDeps = mfaDeps();

  /** A user with one ACTIVE TOTP factor, and the secret behind it. */
  const withTotp = async () => {
    const { userId } = await seedUser(t.app());
    const enrolled = await enrolTotp(t.db(), deps, { userId, accountName: null });
    if (enrolled.outcome !== 'ENROLLED') throw new Error('expected ENROLLED');
    await activateTotp(t.db(), deps, {
      userId,
      factorId: enrolled.factorId,
      code: codeNow(enrolled.secret),
    });
    const factor = await t
      .db()
      .transaction((tx) => findOwnFactor(tx, { userId, factorId: enrolled.factorId }));
    if (!factor) throw new Error('expected an ACTIVE factor');
    return { userId, secret: enrolled.secret, factor };
  };

  const present = async (userId: string, factor: FactorRow, code: string) =>
    t
      .db()
      .transaction((tx) => verifyFactor(tx, deps, { userId, factor, proof: { code }, ceremonyKey: 'test' }));

  /**
   * The replay a 30-second window makes possible: somebody reads the code over the user's shoulder
   * and spends it before it rolls over. The spent step rides back into the sealed record, so the
   * second presentation of the same code is refused.
   */
  it('accepts a TOTP code once and refuses the same code immediately after', async () => {
    const { userId, secret, factor } = await withTotp();
    const code = codeNow(secret);

    expect(await present(userId, factor, code)).toBe(true);

    // Re-read: the sealed record now carries the spent step.
    const again = await t.db().transaction((tx) => findOwnFactor(tx, { userId, factorId: factor.id }));
    expect(await present(userId, again as FactorRow, code)).toBe(false);
  });

  it('records the use on the factor', async () => {
    const { userId, secret, factor } = await withTotp();
    await present(userId, factor, codeNow(secret));

    const row = (await t.db().select().from(mfaFactors).where(eq(mfaFactors.id, factor.id)))[0];
    expect(row?.lastUsedAt).not.toBeNull();
  });

  it('refuses a wrong code without recording a use', async () => {
    const { userId, factor } = await withTotp();
    expect(await present(userId, factor, '000000')).toBe(false);
  });

  /** The last line of defence on ownership: every caller scopes its lookup, and this refuses anyway. */
  it('refuses a factor row belonging to another user', async () => {
    const { secret, factor } = await withTotp();
    const stranger = await seedUser(t.app());
    expect(await present(stranger.userId, factor, codeNow(secret))).toBe(false);
  });

  it('spends one recovery code and never the same one twice', async () => {
    const { userId } = await withTotp();
    const codes = await t.db().transaction((tx) => regenerateRecoveryCodes(tx, deps, userId));
    const sheet = (await t.db().select().from(mfaFactors).where(eq(mfaFactors.userId, userId))).find(
      (row) => row.factorType === 'RECOVERY_CODE' && row.revokedAt === null,
    );
    if (!sheet) throw new Error('expected a recovery-code factor');

    const first = codes[0] as string;
    expect(await present(userId, sheet as FactorRow, first)).toBe(true);

    const reread = (await t.db().select().from(mfaFactors).where(eq(mfaFactors.id, sheet.id)))[0];
    expect(await present(userId, reread as FactorRow, first)).toBe(false);
    // A different code off the same sheet still works.
    expect(await present(userId, reread as FactorRow, codes[1] as string)).toBe(true);
  });
});

describe.runIf(infraEnabled)('removeFactor (§S7, D2 C4)', () => {
  const t = useTestDatabase();

  const withTotp = async (deps: MfaDeps) => {
    const { userId } = await seedUser(t.app());
    const enrolled = await enrolTotp(t.db(), deps, { userId, accountName: null });
    if (enrolled.outcome !== 'ENROLLED') throw new Error('expected ENROLLED');
    const activated = await activateTotp(t.db(), deps, {
      userId,
      factorId: enrolled.factorId,
      code: codeNow(enrolled.secret),
    });
    if (activated.outcome !== 'ACTIVATED') throw new Error('expected ACTIVATED');
    return { userId, factorId: enrolled.factorId };
  };

  const liveFactors = async (userId: string) =>
    (await t.db().select().from(mfaFactors).where(eq(mfaFactors.userId, userId))).filter(
      (row) => row.revokedAt === null,
    );

  it('removes a factor and records it', async () => {
    const deps = mfaDeps();
    const { userId, factorId } = await withTotp(deps);

    const result = await t.db().transaction((tx) => removeFactor(tx, deps, { userId, factorId }));
    expect(result).toEqual({ outcome: 'REMOVED', lastFactor: true });

    const { rows } = await t
      .app()
      .query<{ action: string }>(
        `SELECT action FROM identity.identity_audit_log WHERE subject_user_id = $1`,
        [userId],
      );
    expect(rows.map((r) => r.action)).toContain('MFA_REMOVED');
  });

  /**
   * Ten printed codes are not a second factor — the policy says so, and an account left holding a
   * sheet that still signs it in after its last real factor is gone would make that a lie.
   */
  it('takes the recovery-code sheet with the last real factor', async () => {
    const deps = mfaDeps();
    const { userId, factorId } = await withTotp(deps);
    expect((await liveFactors(userId)).map((row) => row.factorType).sort()).toEqual([
      'RECOVERY_CODE',
      'TOTP',
    ]);

    await t.db().transaction((tx) => removeFactor(tx, deps, { userId, factorId }));
    expect(await liveFactors(userId)).toHaveLength(0);
  });

  /** D2 C4: an admin may not leave themselves without a second factor while §S13 is in force. */
  it('refuses to strip the last factor from a live admin', async () => {
    const deps = mfaDeps({ staffRequireMfa: true });
    const { userId, factorId } = await withTotp(deps);
    await grantRole(t.app(), userId, 'OPERATIONS_ADMIN', ['user.view']);

    expect(await t.db().transaction((tx) => removeFactor(tx, deps, { userId, factorId }))).toEqual({
      outcome: 'LAST_FACTOR_REQUIRED',
    });
    expect((await liveFactors(userId)).some((row) => row.factorType === 'TOTP')).toBe(true);
  });

  it('allows it once the operator switch is off', async () => {
    const deps = mfaDeps({ staffRequireMfa: false });
    const { userId, factorId } = await withTotp(deps);
    await grantRole(t.app(), userId, 'OPERATIONS_ADMIN', ['user.view']);

    expect((await t.db().transaction((tx) => removeFactor(tx, deps, { userId, factorId }))).outcome).toBe(
      'REMOVED',
    );
  });

  it('refuses a factor id that is not yours, and changes nothing', async () => {
    const deps = mfaDeps();
    const { factorId } = await withTotp(deps);
    const stranger = await seedUser(t.app());

    expect(
      await t.db().transaction((tx) => removeFactor(tx, deps, { userId: stranger.userId, factorId })),
    ).toEqual({ outcome: 'UNKNOWN' });
  });

  it('promotes another factor to default when the default is removed', async () => {
    const deps = mfaDeps();
    const { userId, factorId } = await withTotp(deps);

    // A second real factor, inserted directly: what is under test is the promotion, not a ceremony.
    const [second] = await t
      .db()
      .insert(mfaFactors)
      .values({ userId, factorType: 'PASSKEY', status: 'ACTIVE', verifiedAt: new Date() })
      .returning({ id: mfaFactors.id });

    await t.db().transaction((tx) => removeFactor(tx, deps, { userId, factorId }));

    const row = (
      await t
        .db()
        .select()
        .from(mfaFactors)
        .where(eq(mfaFactors.id, second?.id as string))
    )[0];
    expect(row?.isDefault).toBe(true);
  });
});
