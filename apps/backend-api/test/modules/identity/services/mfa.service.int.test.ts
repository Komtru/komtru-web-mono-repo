// Factor enrolment against a real database (screens TF1 and TF2). Skipped unless
// KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  activateSmsFactor,
  activateTotp,
  enrolSmsFactor,
  enrolTotp,
  listFactors,
  regenerateRecoveryCodes,
  type MfaDeps,
} from '../../../../src/modules/identity/services/mfa.service.js';
import {
  parseRecoveryBlob,
  remainingRecoveryCodes,
  RECOVERY_CODE_COUNT,
} from '../../../../src/modules/identity/domain/mfa/recovery-codes.js';
import { parseTotpBlob, totpCodeAt, totpStep } from '../../../../src/modules/identity/domain/mfa/totp.js';
import { mfaFactors } from '../../../../src/modules/identity/infrastructure/postgres/schema/sessions.js';
import { attachPhone, markPhoneVerified } from '../../../../src/modules/identity/services/contact.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { mfaDeps, outboxEventTypes, seedUser } from '../support.js';

const PHONE = '+2348023415567';

const codeFor = (secret: string, offset = 0): string => totpCodeAt(secret, totpStep(Date.now()) + offset);

describe.runIf(infraEnabled)('TOTP enrolment (screen TF1)', () => {
  const t = useTestDatabase();
  const deps: MfaDeps = mfaDeps();

  const enrol = async () => {
    const { userId } = await seedUser(t.app());
    const result = await enrolTotp(t.db(), deps, { userId, accountName: null });
    if (result.outcome !== 'ENROLLED') throw new Error(`expected ENROLLED, got ${result.outcome}`);
    return { userId, ...result };
  };

  it('writes a PENDING factor whose seed is sealed, not stored in clear (§S9)', async () => {
    const { factorId, secret } = await enrol();

    const row = (await t.db().select().from(mfaFactors).where(eq(mfaFactors.id, factorId)))[0];
    expect(row?.status).toBe('PENDING');
    const raw = Buffer.from(row?.secretEnc as Buffer);
    expect(raw.toString('utf8')).not.toContain(secret);
    expect(parseTotpBlob(deps.encryption.open(raw))).toEqual({ v: 1, secret, lastStep: null });
  });

  it('returns the otpauth URI screen TF1 turns into a QR code', async () => {
    const { otpauthUri: uri, secret } = await enrol();
    expect(uri).toContain('otpauth://totp/Komtru:');
    expect(uri).toContain(`secret=${secret}`);
  });

  it('supersedes an abandoned enrolment rather than colliding with it', async () => {
    const { userId, factorId, secret } = await enrol();
    const again = await enrolTotp(t.db(), deps, { userId, accountName: null });

    expect(again.outcome).toBe('ENROLLED');
    if (again.outcome !== 'ENROLLED') return;
    expect(again.secret).not.toBe(secret);

    const first = (await t.db().select().from(mfaFactors).where(eq(mfaFactors.id, factorId)))[0];
    expect(first?.status).toBe('REVOKED');
  });

  it('refuses a second TOTP factor once one is ACTIVE', async () => {
    const { userId, factorId, secret } = await enrol();
    await activateTotp(t.db(), deps, { userId, factorId, code: codeFor(secret) });

    expect((await enrolTotp(t.db(), deps, { userId, accountName: null })).outcome).toBe('ALREADY_ENROLLED');
  });

  it('activates on the right code and hands back ten backup codes (screen TF2)', async () => {
    const { userId, factorId, secret } = await enrol();
    const result = await activateTotp(t.db(), deps, { userId, factorId, code: codeFor(secret) });

    expect(result.outcome).toBe('ACTIVATED');
    if (result.outcome !== 'ACTIVATED') return;
    expect(result.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);

    const row = (await t.db().select().from(mfaFactors).where(eq(mfaFactors.id, factorId)))[0];
    expect(row?.status).toBe('ACTIVE');
    expect(row?.verifiedAt).not.toBeNull();
    expect(row?.isDefault).toBe(true);

    expect(await outboxEventTypes(t.app())).toContain('identity.mfa.enrolled');
    const { rows } = await t
      .app()
      .query<{ action: string }>(
        `SELECT action FROM identity.identity_audit_log WHERE subject_user_id = $1`,
        [userId],
      );
    expect(rows.map((r) => r.action)).toContain('MFA_ENROLLED');
  });

  /**
   * The attempt is charged before the comparison, so the transaction must COMMIT on a miss — a
   * caller who could cut the connection on a wrong code would buy an unmetered guess.
   */
  it('commits a wrong code, charging the attempt, and leaves the factor PENDING', async () => {
    const { userId, factorId } = await enrol();
    const result = await activateTotp(t.db(), deps, { userId, factorId, code: '000000' });

    expect(result).toEqual({ outcome: 'WRONG_CODE', attemptsRemaining: 4 });
    const row = (await t.db().select().from(mfaFactors).where(eq(mfaFactors.id, factorId)))[0];
    expect(row?.status).toBe('PENDING');

    const { rows } = await t
      .app()
      .query<{ attempts: number }>(
        `SELECT attempts FROM identity.otp_challenges WHERE user_id = $1 AND purpose = 'MFA_CHALLENGE'`,
        [userId],
      );
    expect(rows[0]?.attempts).toBe(1);
  });

  it('revokes the enrolment after five misses, rather than letting it be ground down', async () => {
    const { userId, factorId, secret } = await enrol();
    for (let i = 0; i < 5; i += 1) {
      await activateTotp(t.db(), deps, { userId, factorId, code: '000000' });
    }

    // Even the RIGHT code no longer helps: the ceremony is spent.
    expect((await activateTotp(t.db(), deps, { userId, factorId, code: codeFor(secret) })).outcome).toBe(
      'UNKNOWN',
    );
    const row = (await t.db().select().from(mfaFactors).where(eq(mfaFactors.id, factorId)))[0];
    expect(row?.status).toBe('REVOKED');
  });

  /** TF2's codes are shown once, at the moment the account becomes two-factor. */
  it('does not reissue backup codes when a SECOND factor is enrolled', async () => {
    const { userId, factorId, secret } = await enrol();
    await activateTotp(t.db(), deps, { userId, factorId, code: codeFor(secret) });

    await t.db().transaction(async (tx) => {
      const phone = await attachPhone(tx, { userId, phone: PHONE, makePrimary: true });
      await markPhoneVerified(tx, { userId, phoneId: phone.phoneId });
    });
    const sms = await enrolSmsFactor(t.db(), deps, { userId });
    if (sms.outcome !== 'ENROLLED') throw new Error(`expected ENROLLED, got ${sms.outcome}`);

    const { rows } = await t
      .app()
      .query<{ code_hash: Buffer }>(`SELECT code_hash FROM identity.otp_challenges WHERE id = $1`, [
        sms.challengeId,
      ]);
    expect(rows).toHaveLength(1);

    const code = await liveCodeFor(t, sms.challengeId);
    const activated = await activateSmsFactor(t.db(), deps, {
      userId,
      factorId: sms.factorId,
      challengeId: sms.challengeId,
      code,
    });
    expect(activated.outcome).toBe('ACTIVATED');
    if (activated.outcome !== 'ACTIVATED') return;
    expect(activated.recoveryCodes).toBeNull();
  });

  /**
   * `mfa_factors_one_default` is UNIQUE on `(user_id) WHERE is_default AND revoked_at IS NULL`, so
   * two activations committing at once raise 23505 — which drizzle wraps, with the `pg` error on
   * `cause`. Reading `error.code` off the top level would miss it and this would be a 500 on an
   * enrolment that actually succeeded.
   */
  it('lets two activations race for the default without either failing', async () => {
    const a = await enrol();
    const { userId } = a;
    // A second user's factor cannot race; use one user with a TOTP and an SMS factor instead,
    // activated concurrently so both reach `makeDefault`.
    await t.db().transaction(async (tx) => {
      const phone = await attachPhone(tx, { userId, phone: PHONE, makePrimary: true });
      await markPhoneVerified(tx, { userId, phoneId: phone.phoneId });
    });
    const sms = await enrolSmsFactor(t.db(), deps, { userId });
    if (sms.outcome !== 'ENROLLED') throw new Error('expected ENROLLED');
    const smsCode = await liveCodeFor(t, sms.challengeId);

    const [totpResult, smsResult] = await Promise.all([
      activateTotp(t.db(), deps, { userId, factorId: a.factorId, code: codeFor(a.secret) }),
      activateSmsFactor(t.db(), deps, {
        userId,
        factorId: sms.factorId,
        challengeId: sms.challengeId,
        code: smsCode,
      }),
    ]);

    expect(totpResult.outcome).toBe('ACTIVATED');
    expect(smsResult.outcome).toBe('ACTIVATED');

    const { rows } = await t.app().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM identity.mfa_factors
        WHERE user_id = $1 AND is_default AND revoked_at IS NULL`,
      [userId],
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe.runIf(infraEnabled)('SMS factor enrolment', () => {
  const t = useTestDatabase();
  const deps: MfaDeps = mfaDeps();

  it('refuses when the account has no verified phone', async () => {
    const { userId } = await seedUser(t.app());
    expect((await enrolSmsFactor(t.db(), deps, { userId })).outcome).toBe('NO_VERIFIED_PHONE');

    const { rows } = await t
      .app()
      .query<{ n: number }>(`SELECT count(*)::int AS n FROM identity.mfa_factors`);
    expect(rows[0]?.n).toBe(0);
  });

  it('sends one code on SMS only, never fanned out to the account’s email', async () => {
    const { userId } = await seedUser(t.app());
    await t.db().transaction(async (tx) => {
      const phone = await attachPhone(tx, { userId, phone: PHONE, makePrimary: true });
      await markPhoneVerified(tx, { userId, phoneId: phone.phoneId });
    });

    const result = await enrolSmsFactor(t.db(), deps, { userId });
    expect(result.outcome).toBe('ENROLLED');
    if (result.outcome !== 'ENROLLED') return;
    expect(result.maskedDestination).toContain('•••');
    expect(result.maskedDestination).not.toContain('341');

    const { rows } = await t
      .app()
      .query<{ channels: string }>(
        `SELECT payload->>'channels' AS channels FROM platform.outbox WHERE event_type = 'identity.otp.requested'`,
      );
    expect(rows[0]?.channels).toBe('["SMS"]');
  });
});

describe.runIf(infraEnabled)('recovery codes (screen TF2)', () => {
  const t = useTestDatabase();
  const deps: MfaDeps = mfaDeps();

  it('replaces the whole sheet, so an old code stops working', async () => {
    const { userId } = await seedUser(t.app());
    const first = await t.db().transaction((tx) => regenerateRecoveryCodes(tx, deps, userId));
    const second = await t.db().transaction((tx) => regenerateRecoveryCodes(tx, deps, userId));

    expect(first).not.toEqual(second);

    const rows = await t.db().select().from(mfaFactors).where(eq(mfaFactors.userId, userId));
    const live = rows.filter((row) => row.revokedAt === null);
    expect(live).toHaveLength(1);

    const blob = parseRecoveryBlob(deps.encryption.open(Buffer.from(live[0]?.secretEnc as Buffer)));
    expect(blob).not.toBeNull();
    expect(remainingRecoveryCodes(blob as NonNullable<typeof blob>)).toBe(RECOVERY_CODE_COUNT);
  });

  it('shows up in the factor list as a count and never as a code', async () => {
    const { userId } = await seedUser(t.app());
    const codes = await t.db().transaction((tx) => regenerateRecoveryCodes(tx, deps, userId));

    const page = await listFactors(t.db(), deps, { userId, page: 1, limit: 20 });
    const view = page.items.find((item) => item.type === 'RECOVERY_CODE');
    expect(view?.remaining).toBe(RECOVERY_CODE_COUNT);
    expect(JSON.stringify(page.items)).not.toContain(codes[0] as string);
  });
});

/**
 * The code a challenge was issued with, read out of the outbox.
 *
 * `otp_challenges` stores only an HMAC, so there is nothing to read back from it — which is exactly
 * T-032's deferred finding that the code sits in `platform.outbox.payload` in clear. This helper is
 * the clearest demonstration of that problem and it is deliberately named for it.
 */
async function liveCodeFor(t: ReturnType<typeof useTestDatabase>, challengeId: string): Promise<string> {
  const { rows } = await t.app().query<{ code: string }>(
    `SELECT payload->>'code' AS code FROM platform.outbox
      WHERE event_type = 'identity.otp.requested' AND payload->>'challengeId' = $1
      ORDER BY occurred_at DESC LIMIT 1`,
    [challengeId],
  );
  const code = rows[0]?.code;
  if (!code) throw new Error(`no delivered code for challenge ${challengeId}`);
  return code;
}
