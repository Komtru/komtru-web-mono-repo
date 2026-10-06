// `identity.mfa_factors`: enrolling a factor, listing what an account has, presenting one, and
// taking one away.
//
// Two decisions shape the whole file.
//
// ONE — the enrolment ceremony is metered by an `otp_challenges` row, not by a column on the
// factor. `mfa_factors` has no attempt counter, and §S4 caps OTP verification at five attempts per
// challenge; rather than take a migration for a column, `enrolTotp` writes the challenge row the
// activation is counted against beside the factor it is activating. The table already means "a
// short-lived secret with a bounded number of attempts" (T-032), and an enrolment is exactly that.
//
// TWO — recovery codes are ONE factor row, not ten. `secret_enc` holds the sealed blob
// (domain/mfa/recovery-codes.ts), so `GET /me/mfa/factors` reads as a list of factors rather than a
// list of codes, spending one is a single row lock, and the blob holds HMACs so a decrypted column
// is still not a list of codes.
import type { Paged } from '@komtru/shared-types';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { isUniqueViolation } from '../../../db/errors.js';
import type { Encryption } from '../../../platform/crypto/encryption.js';
import { maskPhone } from '../../../platform/identifiers.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import {
  MFA_MAX_ATTEMPTS,
  factorAmr,
  isSecondFactor,
  mfaSubjectHash,
  type MfaFactorType,
} from '../domain/mfa/policy.js';
import {
  RECOVERY_CODE_COUNT,
  buildRecoveryBlob,
  generateRecoveryCodes,
  parseRecoveryBlob,
  remainingRecoveryCodes,
  spendRecoveryCode,
} from '../domain/mfa/recovery-codes.js';
import {
  buildTotpBlob,
  generateTotpSecret,
  otpauthUri,
  parseTotpBlob,
  verifyTotp,
} from '../domain/mfa/totp.js';
import { hashCode, hashDestination, matchesCode, otpExpiry } from '../domain/otp/challenge.js';
import { identityMfaEnrolledEvent, identityMfaRemovedEvent } from '../domain/events.js';
import { mfaFactors, otpChallenges } from '../infrastructure/postgres/schema/sessions.js';
import { adminRoleAssignments, roles } from '../infrastructure/postgres/schema/rbac.js';
import { userPhones } from '../infrastructure/postgres/schema/contacts.js';
import type { RelyingParty } from '../infrastructure/webauthn/relying-party.js';
import type { WebauthnChallengeStore } from '../infrastructure/redis/webauthn-challenge.js';
import { AUDIT_ACTIONS, writeAudit } from './audit.service.js';
import type { AccountDeps } from './auth.service.js';
import { consumeOtp, findLiveChallengeFor, issueOtp } from './otp.service.js';
import {
  beginPasskeyRegistration,
  passkeyAssertionOptions,
  revokePasskey,
  storePasskeyCredential,
  verifyPasskeyAssertion,
} from './passkey.service.js';

export interface MfaDeps extends AccountDeps {
  /** §S9: TOTP seeds and the recovery blob are envelope-encrypted, column level. */
  encryption: Encryption;
  webauthn: RelyingParty;
  webauthnChallenges: WebauthnChallengeStore;
  /** `IDENTITY_STAFF_REQUIRE_MFA` (D2 C4, §S13). */
  staffRequireMfa: boolean;
}

export interface FactorRow {
  id: string;
  userId: string;
  factorType: MfaFactorType;
  status: string;
  label: string | null;
  isDefault: boolean;
  phoneId: string | null;
  secretEnc: Buffer | null;
  verifiedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

const factorColumns = {
  id: mfaFactors.id,
  userId: mfaFactors.userId,
  factorType: mfaFactors.factorType,
  status: mfaFactors.status,
  label: mfaFactors.label,
  isDefault: mfaFactors.isDefault,
  phoneId: mfaFactors.phoneId,
  secretEnc: mfaFactors.secretEnc,
  verifiedAt: mfaFactors.verifiedAt,
  lastUsedAt: mfaFactors.lastUsedAt,
  createdAt: mfaFactors.createdAt,
};

/** What a factor is called when the user never named one. Screen TF1 renders this. */
const DEFAULT_LABEL: Record<MfaFactorType, string> = {
  TOTP: 'Authenticator app',
  SMS_OTP: 'Text message',
  EMAIL_OTP: 'Email code',
  PASSKEY: 'Passkey',
  RECOVERY_CODE: 'Backup codes',
};

export interface FactorView {
  id: string;
  type: MfaFactorType;
  label: string;
  isDefault: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
  /** SMS only: `+234802•••5567`. Absent for every other kind. */
  maskedDestination?: string;
  /** Recovery codes only: how many are unspent. Absent for every other kind. */
  remaining?: number;
}

/**
 * The only shape a factor leaves this module in.
 *
 * `secret_enc` is not on it and cannot be added by accident: the view is built field by field
 * rather than spread from the row, which is the difference between "we remembered to delete the
 * secret" and "the secret was never in the object".
 */
export function factorView(
  row: FactorRow,
  extra: { maskedDestination: string | null; remaining: number | null },
): FactorView {
  return {
    id: row.id,
    type: row.factorType,
    label: row.label ?? DEFAULT_LABEL[row.factorType],
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    ...(extra.maskedDestination !== null ? { maskedDestination: extra.maskedDestination } : {}),
    ...(extra.remaining !== null ? { remaining: extra.remaining } : {}),
  };
}

const liveFactor = (userId: string) =>
  and(eq(mfaFactors.userId, userId), isNull(mfaFactors.revokedAt), eq(mfaFactors.status, 'ACTIVE'));

/** Every ACTIVE factor on an account, recovery codes included. The caller decides what counts. */
export async function activeFactors(tx: Tx, userId: string): Promise<FactorRow[]> {
  return tx
    .select(factorColumns)
    .from(mfaFactors)
    .where(liveFactor(userId))
    .orderBy(desc(mfaFactors.isDefault), mfaFactors.createdAt);
}

/** A live, approved, unexpired admin role grant — the same predicate `resolvePrincipal` uses (D2 C4). */
export async function holdsLiveAdminRole(tx: Tx, userId: string): Promise<boolean> {
  const rows = await tx
    .select({ one: sql<number>`1` })
    .from(adminRoleAssignments)
    .innerJoin(roles, eq(roles.code, adminRoleAssignments.roleCode))
    .where(
      and(
        eq(adminRoleAssignments.userId, userId),
        isNull(adminRoleAssignments.revokedAt),
        sql`(${adminRoleAssignments.expiresAt} IS NULL OR ${adminRoleAssignments.expiresAt} > now())`,
        sql`(NOT ${roles.requiresDualApproval} OR ${adminRoleAssignments.approvedBy} IS NOT NULL)`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** The factor behind an id, scoped to its owner. Another user's id is a miss, never a 403. */
export async function findOwnFactor(
  tx: Tx,
  input: { userId: string; factorId: string; activeOnly?: boolean },
): Promise<FactorRow | null> {
  const row = (
    await tx
      .select(factorColumns)
      .from(mfaFactors)
      .where(
        and(
          eq(mfaFactors.id, input.factorId),
          eq(mfaFactors.userId, input.userId),
          isNull(mfaFactors.revokedAt),
          ...(input.activeOnly === false ? [] : [eq(mfaFactors.status, 'ACTIVE')]),
        ),
      )
  )[0];
  return row ?? null;
}

const openBlob = (deps: MfaDeps, row: FactorRow): string | null => {
  if (!row.secretEnc) return null;
  try {
    return deps.encryption.open(row.secretEnc);
  } catch {
    // A row we cannot decrypt is a key rotation or a corrupt column, not a user error. It must not
    // be a 500 on a sign-in: the factor simply cannot be presented, and the user falls back.
    deps.logger.error({ factorId: row.id }, 'identity: an mfa factor secret did not decrypt');
    return null;
  }
};

const remainingFor = (deps: MfaDeps, row: FactorRow): number | null => {
  if (row.factorType !== 'RECOVERY_CODE') return null;
  const payload = openBlob(deps, row);
  const blob = payload === null ? null : parseRecoveryBlob(payload);
  return blob === null ? 0 : remainingRecoveryCodes(blob);
};

export async function listFactors(
  db: Db,
  deps: MfaDeps,
  input: { userId: string; page: number; limit: number },
): Promise<Paged<FactorView>> {
  const where = liveFactor(input.userId);
  const [rows, totals] = await Promise.all([
    db
      .select({ ...factorColumns, phoneE164: userPhones.phoneE164 })
      .from(mfaFactors)
      .leftJoin(userPhones, eq(userPhones.id, mfaFactors.phoneId))
      .where(where)
      .orderBy(desc(mfaFactors.isDefault), mfaFactors.createdAt)
      .limit(input.limit)
      .offset((input.page - 1) * input.limit),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(mfaFactors)
      .where(where),
  ]);

  return {
    items: rows.map(({ phoneE164, ...row }) =>
      factorView(row, {
        maskedDestination: phoneE164 === null ? null : maskPhone(phoneE164),
        remaining: remainingFor(deps, row),
      }),
    ),
    page: input.page,
    limit: input.limit,
    total: totals[0]?.total ?? 0,
  };
}

// ---------------------------------------------------------------------------
// The ceremony meter
// ---------------------------------------------------------------------------

/**
 * The `otp_challenges` row an enrolment's attempts are counted against.
 *
 * `destination_hash` is the user id under `MFA_SUBJECT_DOMAIN`, not an address: this challenge is
 * bound to an ACCOUNT. The separate domain is what keeps it out of §S4's per-destination send
 * budget and out of `issueOtp`'s supersede, both of which key on that column — without it, enrolling
 * an authenticator app would spend the user's SMS allowance.
 */
async function openCeremony(
  tx: Tx,
  deps: MfaDeps,
  input: { userId: string; factorId: string; ip?: string | null },
): Promise<void> {
  await tx.insert(otpChallenges).values({
    userId: input.userId,
    purpose: 'MFA_CHALLENGE',
    channel: 'EMAIL',
    destinationHash: mfaSubjectHash(deps.otpHasher, input.userId),
    // The factor id IS the secret here: the holder already proved their session, and what this row
    // meters is attempts, not possession.
    codeHash: hashCode(deps.otpHasher, {
      purpose: 'MFA_CHALLENGE',
      destinationHash: mfaSubjectHash(deps.otpHasher, input.userId),
      code: input.factorId,
    }),
    maxAttempts: MFA_MAX_ATTEMPTS,
    expiresAt: otpExpiry(new Date()),
    createdIp: input.ip ?? null,
  });
}

type CeremonySpend = { ok: true; attemptsRemaining: number } | { ok: false };

/** Charges one attempt against an enrolment ceremony. `ok: false` means it is spent or gone. */
async function spendCeremonyAttempt(
  tx: Tx,
  deps: MfaDeps,
  input: { userId: string; factorId: string },
): Promise<CeremonySpend> {
  const destinationHash = mfaSubjectHash(deps.otpHasher, input.userId);
  const challenge = await findLiveChallengeFor(tx, {
    destinationHash,
    purpose: 'MFA_CHALLENGE',
    userId: input.userId,
    forUpdate: true,
  });
  if (
    !challenge ||
    !matchesCode(
      deps.otpHasher,
      { purpose: 'MFA_CHALLENGE', destinationHash, code: input.factorId },
      Buffer.from(challenge.codeHash),
    )
  ) {
    return { ok: false };
  }
  if (challenge.attempts >= challenge.maxAttempts) return { ok: false };

  const attempts = challenge.attempts + 1;
  await tx.update(otpChallenges).set({ attempts }).where(eq(otpChallenges.id, challenge.id));
  return { ok: true, attemptsRemaining: challenge.maxAttempts - attempts };
}

const closeCeremony = async (tx: Tx, deps: MfaDeps, userId: string): Promise<void> => {
  await tx
    .update(otpChallenges)
    .set({ consumedAt: sql`now()` })
    .where(
      and(
        eq(otpChallenges.userId, userId),
        eq(otpChallenges.purpose, 'MFA_CHALLENGE'),
        eq(otpChallenges.destinationHash, mfaSubjectHash(deps.otpHasher, userId)),
        isNull(otpChallenges.consumedAt),
      ),
    );
};

// ---------------------------------------------------------------------------
// Default-factor bookkeeping
// ---------------------------------------------------------------------------

/**
 * Makes `factorId` the default, tolerating the race the partial unique index exists to catch.
 *
 * `mfa_factors_one_default` is UNIQUE on `(user_id) WHERE is_default AND revoked_at IS NULL`, so two
 * activations committing at once produce a 23505 — which drizzle wraps, with the `pg` error on
 * `cause`, so `error.code` at the top level is undefined and the obvious catch misses it entirely
 * (src/db/errors.ts). The loser here keeps an ACTIVE factor that simply is not the default, which is
 * the right answer: the user asked to enrol a factor, not to win a race.
 */
async function makeDefault(
  tx: Tx,
  deps: MfaDeps,
  input: { userId: string; factorId: string },
): Promise<void> {
  try {
    await tx.transaction(async (sp) => {
      await sp
        .update(mfaFactors)
        .set({ isDefault: false })
        .where(and(eq(mfaFactors.userId, input.userId), eq(mfaFactors.isDefault, true)));
      await sp.update(mfaFactors).set({ isDefault: true }).where(eq(mfaFactors.id, input.factorId));
    });
  } catch (error) {
    // A SAVEPOINT above, because a live 23505 aborts the whole Postgres transaction: without it the
    // caller's "enrolled" answer would arrive on a COMMIT that is silently a ROLLBACK.
    if (!isUniqueViolation(error, 'mfa_factors_one_default')) throw error;
    deps.logger.warn(
      { userId: input.userId, factorId: input.factorId },
      'identity: another factor became default first; leaving this one non-default',
    );
  }
}

/** After a revoke: if the account lost its default, give it to the oldest surviving factor. */
async function promoteDefault(tx: Tx, deps: MfaDeps, userId: string): Promise<void> {
  const existing = await tx
    .select({ id: mfaFactors.id, isDefault: mfaFactors.isDefault, factorType: mfaFactors.factorType })
    .from(mfaFactors)
    .where(liveFactor(userId))
    .orderBy(mfaFactors.createdAt);

  if (existing.some((row) => row.isDefault)) return;
  // Never a recovery-code row: "your default way to sign in is a sheet of printed codes" is the
  // wrong prompt, and the policy does not count them as a factor anyway.
  const next = existing.find((row) => isSecondFactor(row.factorType));
  if (next) await makeDefault(tx, deps, { userId, factorId: next.id });
}

// ---------------------------------------------------------------------------
// Recovery codes (screen TF2)
// ---------------------------------------------------------------------------

/**
 * Mints a fresh set and returns them, once.
 *
 * Any previous set is replaced outright rather than topped up: a user who asks for new codes is
 * usually doing it because the old ones are somewhere they should not be.
 */
export async function regenerateRecoveryCodes(tx: Tx, deps: MfaDeps, userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  const sealed = deps.encryption.seal(JSON.stringify(buildRecoveryBlob(deps.otpHasher, codes)));

  await tx
    .update(mfaFactors)
    .set({ revokedAt: sql`now()`, status: 'REVOKED' })
    .where(and(liveFactor(userId), eq(mfaFactors.factorType, 'RECOVERY_CODE')));

  await tx.insert(mfaFactors).values({
    userId,
    factorType: 'RECOVERY_CODE',
    status: 'ACTIVE',
    secretEnc: sealed,
    verifiedAt: sql`now()`,
  });

  await writeAudit(tx, {
    action: AUDIT_ACTIONS.MFA_RECOVERY_CODES_ISSUED,
    outcome: 'SUCCESS',
    actorType: 'USER',
    actorUserId: userId,
    subjectUserId: userId,
    metadata: { count: RECOVERY_CODE_COUNT },
  });

  return codes;
}

/** True once the account holds a real second factor — which is when TF2's codes are worth minting. */
const hasSecondFactor = (rows: { factorType: MfaFactorType }[]): boolean =>
  rows.some((row) => isSecondFactor(row.factorType));

// ---------------------------------------------------------------------------
// TOTP enrolment (screen TF1)
// ---------------------------------------------------------------------------

export type EnrolTotpResult =
  | { outcome: 'ENROLLED'; factorId: string; secret: string; otpauthUri: string }
  | { outcome: 'ALREADY_ENROLLED' };

export async function enrolTotp(
  db: Db,
  deps: MfaDeps,
  input: { userId: string; accountName: string | null; ip?: string | null },
): Promise<EnrolTotpResult> {
  return db.transaction(async (tx) => {
    const live = await activeFactors(tx, input.userId);
    if (live.some((row) => row.factorType === 'TOTP')) return { outcome: 'ALREADY_ENROLLED' };

    // A PENDING enrolment the user abandoned is superseded rather than left to collide: screen TF1
    // can be opened twice, and the second QR code is the one in front of them.
    await tx
      .update(mfaFactors)
      .set({ revokedAt: sql`now()`, status: 'REVOKED' })
      .where(
        and(
          eq(mfaFactors.userId, input.userId),
          eq(mfaFactors.factorType, 'TOTP'),
          eq(mfaFactors.status, 'PENDING'),
          isNull(mfaFactors.revokedAt),
        ),
      );

    const secret = generateTotpSecret();
    const row = (
      await tx
        .insert(mfaFactors)
        .values({
          userId: input.userId,
          factorType: 'TOTP',
          status: 'PENDING',
          secretEnc: deps.encryption.seal(JSON.stringify(buildTotpBlob(secret))),
        })
        .returning({ id: mfaFactors.id })
    )[0];
    if (!row) throw new Error('enrolTotp: the insert returned no row');

    await openCeremony(tx, deps, { userId: input.userId, factorId: row.id, ip: input.ip ?? null });

    return {
      outcome: 'ENROLLED',
      factorId: row.id,
      secret,
      otpauthUri: otpauthUri({
        secretBase32: secret,
        // The label the authenticator app files it under. The public id, not an email, unless the
        // caller supplies one: §S12 keeps an address out of anything we can avoid putting it in,
        // and the app shows this string forever.
        accountName: input.accountName ?? input.userId,
        issuer: deps.webauthn.rpName,
      }),
    };
  });
}

export type ActivateResult =
  | { outcome: 'ACTIVATED'; factorId: string; recoveryCodes: string[] | null }
  | { outcome: 'WRONG_CODE'; attemptsRemaining: number }
  /** No such pending factor, or the ceremony is spent. One variant for all three. */
  | { outcome: 'UNKNOWN' };

/**
 * Turns the PENDING factor ACTIVE once the user proves the authenticator holds the seed.
 *
 * The attempt is charged BEFORE the comparison and the transaction COMMITS on a wrong code, for
 * `consumeOtp`'s reason: a caller who could cut the connection on a miss would buy an unmetered
 * guess. Five misses revoke the enrolment outright — the seed is on the user's phone and starting
 * again costs one QR code.
 */
export async function activateTotp(
  db: Db,
  deps: MfaDeps,
  input: { userId: string; factorId: string; code: string; ip?: string | null; userAgent?: string | null },
): Promise<ActivateResult> {
  return db.transaction(async (tx) => {
    const row = (
      await tx
        .select(factorColumns)
        .from(mfaFactors)
        .where(
          and(
            eq(mfaFactors.id, input.factorId),
            eq(mfaFactors.userId, input.userId),
            eq(mfaFactors.factorType, 'TOTP'),
            eq(mfaFactors.status, 'PENDING'),
            isNull(mfaFactors.revokedAt),
          ),
        )
        .for('update')
    )[0];
    if (!row) return { outcome: 'UNKNOWN' };

    const spend = await spendCeremonyAttempt(tx, deps, {
      userId: input.userId,
      factorId: input.factorId,
    });
    if (!spend.ok) {
      await tx
        .update(mfaFactors)
        .set({ revokedAt: sql`now()`, status: 'REVOKED' })
        .where(eq(mfaFactors.id, row.id));
      return { outcome: 'UNKNOWN' };
    }

    const payload = openBlob(deps, row);
    const blob = payload === null ? null : parseTotpBlob(payload);
    if (!blob) return { outcome: 'UNKNOWN' };

    const verdict = verifyTotp(blob.secret, input.code, { atMs: Date.now(), afterStep: blob.lastStep });
    if (!verdict.ok) {
      await writeAudit(tx, {
        action: AUDIT_ACTIONS.MFA_FAILED,
        outcome: 'FAILURE',
        actorType: 'USER',
        actorUserId: input.userId,
        subjectUserId: input.userId,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        metadata: { factorId: row.id, factorType: 'TOTP', phase: 'activate' },
      });
      return { outcome: 'WRONG_CODE', attemptsRemaining: spend.attemptsRemaining };
    }

    return completeEnrolment(tx, deps, {
      row,
      /** The spent step rides back into the sealed record, so this code cannot be replayed. */
      secretEnc: deps.encryption.seal(JSON.stringify({ ...blob, lastStep: verdict.step })),
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });
  });
}

/**
 * The last half of every enrolment: activate, take the default if the account has none, mint TF2's
 * codes if this is the first real factor, audit, publish.
 *
 * Shared by TOTP, SMS and passkey so the three cannot drift on which of those steps they do.
 */
export async function completeEnrolment(
  tx: Tx,
  deps: MfaDeps,
  input: { row: FactorRow; secretEnc?: Buffer; ip: string | null; userAgent: string | null },
): Promise<{ outcome: 'ACTIVATED'; factorId: string; recoveryCodes: string[] | null }> {
  const before = await activeFactors(tx, input.row.userId);
  const isFirstFactor = !hasSecondFactor(before);

  await tx
    .update(mfaFactors)
    .set({
      status: 'ACTIVE',
      verifiedAt: sql`now()`,
      lastUsedAt: sql`now()`,
      ...(input.secretEnc ? { secretEnc: input.secretEnc } : {}),
    })
    .where(eq(mfaFactors.id, input.row.id));

  await closeCeremony(tx, deps, input.row.userId);
  if (!before.some((row) => row.isDefault)) {
    await makeDefault(tx, deps, { userId: input.row.userId, factorId: input.row.id });
  }

  // TF2's codes are shown ONCE, at the moment the account becomes two-factor. Minting a new set on
  // every subsequent enrolment would silently invalidate the sheet the user already wrote down.
  const recoveryCodes = isFirstFactor ? await regenerateRecoveryCodes(tx, deps, input.row.userId) : null;

  await writeAudit(tx, {
    action: AUDIT_ACTIONS.MFA_ENROLLED,
    outcome: 'SUCCESS',
    actorType: 'USER',
    actorUserId: input.row.userId,
    subjectUserId: input.row.userId,
    ip: input.ip,
    userAgent: input.userAgent,
    metadata: { factorId: input.row.id, factorType: input.row.factorType, isFirstFactor },
  });

  await publish(tx, identityMfaEnrolledEvent, {
    payload: {
      userId: input.row.userId,
      factorId: input.row.id,
      factorType: input.row.factorType,
      isFirstFactor,
    },
    aggregateType: 'identity.user',
    aggregateId: input.row.userId,
    actor: { type: 'CONSUMER', id: input.row.userId },
  });

  return { outcome: 'ACTIVATED', factorId: input.row.id, recoveryCodes };
}

// ---------------------------------------------------------------------------
// SMS factor
// ---------------------------------------------------------------------------

export type EnrolSmsResult =
  | {
      outcome: 'ENROLLED';
      factorId: string;
      challengeId: string;
      maskedDestination: string;
      expiresAt: Date;
      delivered: boolean;
    }
  | { outcome: 'NO_VERIFIED_PHONE' }
  | { outcome: 'ALREADY_ENROLLED' };

/**
 * Enrols the account's primary VERIFIED phone as a factor.
 *
 * Verified and not merely attached: an unproven number is not globally unique (the uniqueness index
 * is partial), so two accounts may each claim it, and a factor on one of those would be a factor
 * somebody else's handset satisfies.
 */
export async function enrolSmsFactor(
  db: Db,
  deps: MfaDeps,
  input: { userId: string; ip?: string | null },
): Promise<EnrolSmsResult> {
  return db.transaction(async (tx) => {
    const live = await activeFactors(tx, input.userId);
    if (live.some((row) => row.factorType === 'SMS_OTP')) return { outcome: 'ALREADY_ENROLLED' };

    const phone = (
      await tx
        .select({ id: userPhones.id, phoneE164: userPhones.phoneE164 })
        .from(userPhones)
        .where(
          and(
            eq(userPhones.userId, input.userId),
            eq(userPhones.isPrimary, true),
            sql`${userPhones.verifiedAt} IS NOT NULL`,
          ),
        )
        .limit(1)
    )[0];
    if (!phone) return { outcome: 'NO_VERIFIED_PHONE' };

    await tx
      .update(mfaFactors)
      .set({ revokedAt: sql`now()`, status: 'REVOKED' })
      .where(
        and(
          eq(mfaFactors.userId, input.userId),
          eq(mfaFactors.factorType, 'SMS_OTP'),
          eq(mfaFactors.status, 'PENDING'),
          isNull(mfaFactors.revokedAt),
        ),
      );

    const row = (
      await tx
        .insert(mfaFactors)
        .values({
          userId: input.userId,
          factorType: 'SMS_OTP',
          status: 'PENDING',
          phoneId: phone.id,
        })
        .returning({ id: mfaFactors.id })
    )[0];
    if (!row) throw new Error('enrolSmsFactor: the insert returned no row');

    const challenge = await issueOtp(
      tx,
      { hasher: deps.otpHasher, logger: deps.logger },
      {
        userId: input.userId,
        purpose: 'MFA_CHALLENGE',
        channels: ['SMS'],
        destination: phone.phoneE164,
        ip: input.ip ?? null,
      },
    );

    return {
      outcome: 'ENROLLED',
      factorId: row.id,
      challengeId: challenge.challengeId,
      maskedDestination: maskPhone(phone.phoneE164),
      expiresAt: challenge.expiresAt,
      delivered: challenge.delivered,
    };
  });
}

export async function activateSmsFactor(
  db: Db,
  deps: MfaDeps,
  input: {
    userId: string;
    factorId: string;
    challengeId: string;
    code: string;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<ActivateResult> {
  return db.transaction(async (tx) => {
    const row = (
      await tx
        .select(factorColumns)
        .from(mfaFactors)
        .where(
          and(
            eq(mfaFactors.id, input.factorId),
            eq(mfaFactors.userId, input.userId),
            eq(mfaFactors.factorType, 'SMS_OTP'),
            eq(mfaFactors.status, 'PENDING'),
            isNull(mfaFactors.revokedAt),
          ),
        )
        .for('update')
    )[0];
    if (!row) return { outcome: 'UNKNOWN' };

    // The OTP row carries its own attempt cap (§S4, five per challenge), so this ceremony is
    // metered by the code the user is typing rather than by a second counter beside it.
    const verdict = await consumeOtp(
      tx,
      { hasher: deps.otpHasher, logger: deps.logger },
      {
        challengeId: input.challengeId,
        code: input.code,
      },
    );

    if (verdict.outcome === 'WRONG_CODE') {
      return { outcome: 'WRONG_CODE', attemptsRemaining: verdict.attemptsRemaining };
    }
    if (verdict.outcome !== 'VERIFIED') return { outcome: 'UNKNOWN' };
    // The challenge must be the one this factor's phone was sent, not any live challenge the user
    // happens to hold: without this, a registration code for a different purpose would activate a
    // factor nobody proved possession of.
    if (verdict.challenge.userId !== input.userId) return { outcome: 'UNKNOWN' };

    return completeEnrolment(tx, deps, {
      row,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });
  });
}

// ---------------------------------------------------------------------------
// Passkey enrolment
// ---------------------------------------------------------------------------

/**
 * `navigator.credentials.create()` options.
 *
 * `ceremonyKey` is the caller's SESSION id, so the ceremony can only be finished on the session
 * that began it — a nonce is not a credential, but one that any session could spend is one fewer
 * thing an attacker who captured a response has to get right.
 */
export async function passkeyRegistrationOptions(
  db: Db,
  deps: MfaDeps,
  input: { userId: string; userName: string; displayName: string; ceremonyKey: string },
): Promise<Record<string, unknown>> {
  return db.transaction((tx) => beginPasskeyRegistration(tx, deps, input));
}

export type PasskeyRegistrationResult =
  | { outcome: 'ACTIVATED'; factorId: string; recoveryCodes: string[] | null }
  | { outcome: 'REJECTED' }
  | { outcome: 'ALREADY_REGISTERED' };

export async function completePasskeyRegistration(
  db: Db,
  deps: MfaDeps,
  input: {
    userId: string;
    ceremonyKey: string;
    response: unknown;
    label: string | null;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<PasskeyRegistrationResult> {
  return db.transaction(async (tx) => {
    const stored = await storePasskeyCredential(tx, deps, {
      userId: input.userId,
      ceremonyKey: input.ceremonyKey,
      response: input.response,
      label: input.label,
    });
    if (stored.outcome !== 'STORED') return { outcome: stored.outcome };

    // The factor row and the credential row are one-to-one, joined by the credential's primary key
    // in `label`'s sibling column — there is no FK between `mfa_factors` and `passkey_credentials`
    // in M1 §5.8, so the factor carries the credential row id in its `secret_enc` payload. Sealed
    // like every other `_enc` value, for no secrecy reason but so the column holds one shape.
    const row = (
      await tx
        .insert(mfaFactors)
        .values({
          userId: input.userId,
          factorType: 'PASSKEY',
          status: 'PENDING',
          label: input.label,
          secretEnc: deps.encryption.seal(JSON.stringify({ v: 1, credentialRowId: stored.credentialRowId })),
        })
        .returning(factorColumns)
    )[0];
    if (!row) throw new Error('completePasskeyRegistration: the insert returned no row');

    return completeEnrolment(tx, deps, {
      row,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });
  });
}

/** The `passkey_credentials` row behind a PASSKEY factor, or null when the payload is not one. */
function passkeyCredentialRowId(deps: MfaDeps, row: FactorRow): string | null {
  const payload = openBlob(deps, row);
  if (payload === null) return null;
  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const id = (parsed as { credentialRowId?: unknown }).credentialRowId;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Presenting a factor
// ---------------------------------------------------------------------------

export type FactorChallenge =
  | {
      kind: 'CODE';
      challengeId: string | null;
      maskedDestination: string | null;
      expiresAt: Date | null;
      delivered: boolean;
    }
  | { kind: 'PASSKEY'; options: Record<string, unknown> };

/**
 * Whatever has to happen before the user can present this factor.
 *
 * TOTP and recovery codes need nothing — the secret is already in the user's hand. SMS needs a code
 * sent. A passkey needs a server nonce, which is why `ceremonyKey` is here: it scopes the stored
 * challenge to the session or the mfa token that began it, so a ceremony started on one cannot be
 * finished on another.
 */
export async function issueFactorChallenge(
  tx: Tx,
  deps: MfaDeps,
  input: { userId: string; factor: FactorRow; ceremonyKey: string; ip?: string | null },
): Promise<FactorChallenge> {
  if (input.factor.factorType === 'PASSKEY') {
    return {
      kind: 'PASSKEY',
      options: await passkeyAssertionOptions(tx, deps, {
        userId: input.userId,
        ceremonyKey: input.ceremonyKey,
      }),
    };
  }

  // Only SMS has something to send. TOTP, recovery codes and (in this build) EMAIL_OTP — which no
  // route enrols — need nothing: the secret is already in the user's hand.
  if (input.factor.factorType !== 'SMS_OTP') {
    return { kind: 'CODE', challengeId: null, maskedDestination: null, expiresAt: null, delivered: true };
  }

  const phone = input.factor.phoneId
    ? (
        await tx
          .select({ phoneE164: userPhones.phoneE164 })
          .from(userPhones)
          .where(eq(userPhones.id, input.factor.phoneId))
      )[0]
    : undefined;
  if (!phone) {
    // The number was detached or deleted under the factor. Nothing can be sent, and saying so is
    // better than an SMS that never arrives.
    return { kind: 'CODE', challengeId: null, maskedDestination: null, expiresAt: null, delivered: false };
  }

  const challenge = await issueOtp(
    tx,
    { hasher: deps.otpHasher, logger: deps.logger },
    {
      userId: input.userId,
      purpose: 'MFA_CHALLENGE',
      channels: ['SMS'],
      destination: phone.phoneE164,
      ip: input.ip ?? null,
    },
  );

  return {
    kind: 'CODE',
    challengeId: challenge.challengeId,
    maskedDestination: maskPhone(phone.phoneE164),
    expiresAt: challenge.expiresAt,
    delivered: challenge.delivered,
  };
}

export interface FactorProof {
  code?: string;
  assertion?: unknown;
}

/**
 * Does this proof satisfy this factor?
 *
 * The last line of defence on ownership: every caller already scopes its lookup by `user_id`, and
 * this refuses anyway, because the function is one argument away from being handed a row somebody
 * else's request fetched.
 */
export async function verifyFactor(
  tx: Tx,
  deps: MfaDeps,
  input: { userId: string; factor: FactorRow; proof: FactorProof; ceremonyKey: string },
): Promise<boolean> {
  if (input.factor.userId !== input.userId) return false;
  if (input.factor.status !== 'ACTIVE') return false;

  const touch = async (): Promise<void> => {
    await tx
      .update(mfaFactors)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(mfaFactors.id, input.factor.id));
  };

  switch (input.factor.factorType) {
    case 'PASSKEY': {
      if (input.proof.assertion === undefined) return false;
      const ok = await verifyPasskeyAssertion(tx, deps, {
        userId: input.userId,
        ceremonyKey: input.ceremonyKey,
        response: input.proof.assertion,
      });
      if (ok) await touch();
      return ok;
    }

    case 'TOTP': {
      if (input.proof.code === undefined) return false;
      const payload = openBlob(deps, input.factor);
      const blob = payload === null ? null : parseTotpBlob(payload);
      if (!blob) return false;

      const verdict = verifyTotp(blob.secret, input.proof.code, {
        atMs: Date.now(),
        afterStep: blob.lastStep,
      });
      if (!verdict.ok) return false;

      // The spent step goes back into the sealed record in the same statement that records the use,
      // so the code the user just typed cannot be typed again inside its own 30-second window.
      await tx
        .update(mfaFactors)
        .set({
          lastUsedAt: sql`now()`,
          secretEnc: deps.encryption.seal(JSON.stringify({ ...blob, lastStep: verdict.step })),
        })
        .where(eq(mfaFactors.id, input.factor.id));
      return true;
    }

    case 'EMAIL_OTP':
    case 'SMS_OTP': {
      if (input.proof.code === undefined || !input.factor.phoneId) return false;
      const phone = (
        await tx
          .select({ phoneE164: userPhones.phoneE164 })
          .from(userPhones)
          .where(eq(userPhones.id, input.factor.phoneId))
      )[0];
      if (!phone) return false;

      const challenge = await findLiveChallengeFor(tx, {
        destinationHash: hashDestination(deps.otpHasher, phone.phoneE164),
        purpose: 'MFA_CHALLENGE',
        userId: input.userId,
      });
      if (!challenge) return false;

      const verdict = await consumeOtp(
        tx,
        { hasher: deps.otpHasher, logger: deps.logger },
        {
          challengeId: challenge.id,
          code: input.proof.code,
        },
      );
      if (verdict.outcome !== 'VERIFIED') return false;
      await touch();
      return true;
    }

    case 'RECOVERY_CODE': {
      if (input.proof.code === undefined) return false;
      // `FOR UPDATE`, because two requests presenting the same sheet must not each spend a
      // different code off the same blob and have one write silently overwrite the other.
      const locked = (
        await tx
          .select(factorColumns)
          .from(mfaFactors)
          .where(eq(mfaFactors.id, input.factor.id))
          .for('update')
      )[0];
      if (!locked || locked.status !== 'ACTIVE') return false;

      const payload = openBlob(deps, locked);
      const blob = payload === null ? null : parseRecoveryBlob(payload);
      if (!blob) return false;

      const spent = spendRecoveryCode(deps.otpHasher, blob, input.proof.code, Date.now());
      if (!spent) return false;

      await tx
        .update(mfaFactors)
        .set({ lastUsedAt: sql`now()`, secretEnc: deps.encryption.seal(JSON.stringify(spent)) })
        .where(eq(mfaFactors.id, locked.id));
      return true;
    }
  }
}

/** What a presented factor contributes to `sessions.amr`. */
export const amrFor = (factor: FactorRow): string => factorAmr(factor.factorType);

// ---------------------------------------------------------------------------
// Removal (§S7: step-up required — the controller enforces it)
// ---------------------------------------------------------------------------

export type RemoveFactorResult =
  | { outcome: 'REMOVED'; lastFactor: boolean }
  | { outcome: 'UNKNOWN' }
  /** D2 C4: an admin may not leave themselves without a second factor while §S13 is in force. */
  | { outcome: 'LAST_FACTOR_REQUIRED' };

export async function removeFactor(
  tx: Tx,
  deps: MfaDeps,
  input: { userId: string; factorId: string; ip?: string | null; userAgent?: string | null },
): Promise<RemoveFactorResult> {
  const row = await findOwnFactor(tx, { userId: input.userId, factorId: input.factorId });
  if (!row) return { outcome: 'UNKNOWN' };

  const live = await activeFactors(tx, input.userId);
  const survivors = live.filter((candidate) => candidate.id !== row.id);
  const lastFactor = isSecondFactor(row.factorType) && !hasSecondFactor(survivors);

  if (lastFactor && deps.staffRequireMfa && (await holdsLiveAdminRole(tx, input.userId))) {
    return { outcome: 'LAST_FACTOR_REQUIRED' };
  }

  await tx
    .update(mfaFactors)
    .set({ revokedAt: sql`now()`, status: 'REVOKED', isDefault: false })
    .where(and(eq(mfaFactors.id, row.id), eq(mfaFactors.userId, input.userId)));

  // A revoked PASSKEY factor whose credential row survived would still answer an assertion, because
  // `verifyPasskeyAssertion` looks the credential up directly. The two rows die together.
  if (row.factorType === 'PASSKEY') {
    const credentialRowId = passkeyCredentialRowId(deps, row);
    if (credentialRowId) await revokePasskey(tx, { userId: input.userId, credentialRowId });
  }

  // Ten printed codes are not a second factor (domain/mfa/policy.ts), so an account that just lost
  // its last real one must not be left holding a sheet that still signs it in.
  if (lastFactor) {
    await tx
      .update(mfaFactors)
      .set({ revokedAt: sql`now()`, status: 'REVOKED', isDefault: false })
      .where(and(liveFactor(input.userId), eq(mfaFactors.factorType, 'RECOVERY_CODE')));
  } else {
    await promoteDefault(tx, deps, input.userId);
  }

  await writeAudit(tx, {
    action: AUDIT_ACTIONS.MFA_REMOVED,
    outcome: 'SUCCESS',
    actorType: 'USER',
    actorUserId: input.userId,
    subjectUserId: input.userId,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    metadata: { factorId: row.id, factorType: row.factorType, lastFactor },
  });

  await publish(tx, identityMfaRemovedEvent, {
    payload: { userId: input.userId, factorId: row.id, factorType: row.factorType, lastFactor },
    aggregateType: 'identity.user',
    aggregateId: input.userId,
    actor: { type: 'CONSUMER', id: input.userId },
  });

  return { outcome: 'REMOVED', lastFactor };
}
