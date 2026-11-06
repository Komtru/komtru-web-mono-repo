// `POST /auth/login` (screen E4), and the §S3 guarantee that makes it safe to accept a username.
//
// M1 §10.1 allows the single `identifier` field to be an email, a phone or a handle, and says so is
// safe "PROVIDED the failure response is uniform — the same body, status and timing whether the user
// does not exist, the password is wrong, or the account is social-only". That provision is the whole
// design of this file:
//
//   - `LoginResult` has exactly ONE failure. There is no 'NO_SUCH_USER', no 'LOCKED', no
//     'SUSPENDED' to leak upwards, because a union with those members is a union somebody will
//     eventually map onto three different status codes.
//   - `resolveLoginCandidate` runs ONE statement whatever the identifier is, so the hit and the
//     miss cost the same round trips.
//   - `verifyAndRecord` is called with `userId: null` on a miss, so the decoy argon2 verification
//     runs and the miss is not ~50ms faster than the hit.
import { and, eq, isNotNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { publish } from '../../../platform/events/publish.js';
import { sha256 } from '../../../platform/crypto/hmac.js';
import { classifyIdentifier, normaliseEmail, normalisePhone } from '../../../platform/identifiers.js';
import { identityDeviceSignedInEvent, identityLoginFailedEvent } from '../domain/events.js';
import { nextStep, type NextStep } from '../domain/registration.js';
import { sessionUsableUnder } from '../domain/session/status.js';
import { userEmails, userPhones } from '../infrastructure/postgres/schema/contacts.js';
import { users } from '../infrastructure/postgres/schema/users.js';
import { AUDIT_ACTIONS, writeAudit } from './audit.service.js';
import { onboarding, type PublicUser } from './auth.service.js';
import { mfaRequirement } from '../domain/mfa/policy.js';
import { issueMfaToken, type MfaChallengeView } from './mfa-login.service.js';
import { activeFactors, holdsLiveAdminRole, type MfaDeps } from './mfa.service.js';
import { verifyAndRecord } from './credential.service.js';
import { deviceLabel, signInLocation, upsertDevice } from './device.service.js';
import { createSession, type IssuedSession } from './session.service.js';
import type { Tx } from '../../../platform/events/publish.js';

export type LoginResult =
  | { outcome: 'SESSION'; session: IssuedSession; user: PublicUser; nextStep: NextStep }
  /**
   * §10.1's `{ mfaRequired: true, mfaToken, factors }` (T-036).
   *
   * A SECOND SUCCESS, not a second failure, and the distinction is the whole design. This variant
   * is reachable only once the password has verified and the status has passed — only, that is, for
   * somebody who already holds the account's credentials — so it cannot tell an attacker which of
   * two identifiers names a real account. The §17 suite holds that with a statement count as well
   * as a stopwatch; see `mfa-login.service.ts` for why both.
   */
  | { outcome: 'MFA_REQUIRED'; mfaToken: string; expiresAt: Date; factors: MfaChallengeView[] }
  /** Still the only failure. §S3: one status, one body, one cost, whatever actually went wrong. */
  | { outcome: 'REJECTED' };

export interface LoginInput {
  identifier: string;
  password: string;
  deviceFingerprint?: string;
  ip: string | null;
  userAgent: string | null;
}

export interface LoginCandidate {
  userId: string;
  status: string;
}

/**
 * Who, if anyone, this identifier names.
 *
 * ONE statement for all three kinds. A branch that ran "look up the email, and if that misses look
 * up the phone" would make a username miss cost three round trips and an email hit one, which is a
 * measurable difference that no amount of argon2 padding hides.
 *
 * Contacts are joined on `verified_at IS NOT NULL`. An unproven address is not unique — two accounts
 * may each claim the same one, as `user_emails_verified_unique` being a PARTIAL index allows — so
 * resolving a sign-in through one would be ambiguous at best and a takeover at worst.
 */
export async function resolveLoginCandidate(tx: Tx, identifier: string): Promise<LoginCandidate | null> {
  const kind = classifyIdentifier(identifier);
  const trimmed = identifier.trim();

  // Only one of these is ever non-null, and the `WHERE` below uses exactly one — but all three are
  // computed so the work before the query does not vary by kind either.
  const emailNormal = kind === 'EMAIL' ? safeEmailNormal(trimmed) : null;
  const phoneE164 = kind === 'PHONE' ? (normalisePhone(trimmed)?.phoneE164 ?? null) : null;
  const username = kind === 'USERNAME' ? trimmed.replace(/^@/, '').toLowerCase() : null;

  const row = (
    await tx
      .select({ userId: users.id, status: users.status })
      .from(users)
      .leftJoin(
        userEmails,
        and(
          eq(userEmails.userId, users.id),
          isNotNull(userEmails.verifiedAt),
          eq(userEmails.emailNormal, emailNormal ?? ''),
        ),
      )
      .leftJoin(
        userPhones,
        and(
          eq(userPhones.userId, users.id),
          isNotNull(userPhones.verifiedAt),
          eq(userPhones.phoneE164, phoneE164 ?? ''),
        ),
      )
      .where(
        or(
          username === null ? sql`false` : eq(users.username, username),
          emailNormal === null ? sql`false` : isNotNull(userEmails.id),
          phoneE164 === null ? sql`false` : isNotNull(userPhones.id),
        ),
      )
      .limit(1)
  )[0];

  return row ?? null;
}

const safeEmailNormal = (value: string): string | null => {
  try {
    return normaliseEmail(value).emailNormal;
  } catch {
    return null;
  }
};

/** §S12: Risk needs to know forty failures share a subject, never what the subject was. */
const identifierDigest = (identifier: string): string =>
  sha256(identifier.trim().toLowerCase()).toString('hex');

export interface LoginOptions {
  /**
   * CONSUMER by default. STAFF is `POST /auth/staff/login` (T-037): password and a second factor
   * only, never a session from the password alone, and only for an account holding a live role.
   */
  scope?: 'CONSUMER' | 'STAFF';
}

export async function login(
  db: Db,
  deps: MfaDeps,
  input: LoginInput,
  options: LoginOptions = {},
): Promise<LoginResult> {
  const scope = options.scope ?? 'CONSUMER';
  return db.transaction(async (tx): Promise<LoginResult> => {
    const candidate = await resolveLoginCandidate(tx, input.identifier);

    // `candidate?.userId ?? null` is the §S3 contract in one expression: on a miss the credential
    // service does the decoy argon2 work rather than this function deciding to skip it.
    const verdict = await verifyAndRecord(tx, deps, {
      userId: candidate?.userId ?? null,
      password: input.password,
    });

    // The status check comes AFTER the password work, never before: a suspended account that
    // answered before hashing would be ~50ms faster to probe than a live one.
    const usable = candidate !== null && sessionUsableUnder(candidate.status);

    if (verdict.outcome !== 'OK' || !candidate || !usable) {
      await recordFailure(tx, input, candidate, verdict.outcome, usable);
      return { outcome: 'REJECTED' };
    }

    // ───────────────────────────────────────────────────────────────────────────────────────────
    // EVERYTHING BELOW THIS LINE HAS ALREADY PROVED THE PASSWORD.
    //
    // Nothing above it may learn whether this account holds an MFA factor. A statement moved up
    // there — even one whose answer is discarded — turns "is this account hardened?" into a
    // difference between a hit and a miss, which is precisely the §17 property T-032 built the
    // single failure variant to protect and the one thing this branch could have broken.
    //
    // `login.mfa-enumeration.int.test.ts` holds the line two ways: a timing comparison, which is
    // what §17 literally asks for, and a COUNT of the statements the rejected path issues, which a
    // fast machine cannot hide an extra indexed lookup inside.
    // ───────────────────────────────────────────────────────────────────────────────────────────
    // The staff gate. Reached only with the password proved, so what it refuses on cannot tell a
    // stranger anything about an account: no live role, or no second factor enrolled, is the same
    // `REJECTED` as a wrong password. An admin who has not yet enrolled MFA signs in as a consumer,
    // enrols on the `/me` routes, and then comes back here (D2 C4's forced setup, without a
    // half-privileged session in between).
    if (scope === 'STAFF') {
      const factors = await activeFactors(tx, candidate.userId);
      const holdsRole = await holdsLiveAdminRole(tx, candidate.userId);
      const requirement = mfaRequirement({
        scope: 'STAFF',
        activeFactorTypes: factors.map((factor) => factor.factorType),
        holdsAdminRole: holdsRole,
        staffRequireMfa: deps.staffRequireMfa,
      });
      if (!holdsRole || !requirement.required || requirement.enrolmentRequired) {
        await recordFailure(
          tx,
          input,
          candidate,
          !holdsRole ? 'no_staff_role' : 'staff_mfa_not_enrolled',
          true,
        );
        return { outcome: 'REJECTED' };
      }
      const challenge = await issueMfaToken(tx, deps, {
        userId: candidate.userId,
        factors,
        ip: input.ip,
        scope: 'STAFF',
      });
      await writeAudit(tx, {
        action: AUDIT_ACTIONS.MFA_CHALLENGED,
        outcome: 'SUCCESS',
        actorType: 'STAFF',
        actorUserId: candidate.userId,
        subjectUserId: candidate.userId,
        ip: input.ip,
        userAgent: input.userAgent,
        metadata: { scope, challengeId: challenge.challengeId, factorCount: challenge.factors.length },
      });
      return {
        outcome: 'MFA_REQUIRED',
        mfaToken: challenge.mfaToken,
        expiresAt: challenge.expiresAt,
        factors: challenge.factors,
      };
    }

    const factors = await activeFactors(tx, candidate.userId);
    const requirement = mfaRequirement({
      scope: 'CONSUMER',
      activeFactorTypes: factors.map((factor) => factor.factorType),
      // Not a lookup, deliberately. `mfaRequirement` makes this inert for CONSUMER (D2 C4's forced
      // setup is about STAFF sessions, §S13), so querying the role grants here would be a round
      // trip on the success path that cannot change the answer. The staff branch above passes the
      // real value.
      holdsAdminRole: false,
      staffRequireMfa: deps.staffRequireMfa,
    });

    if (requirement.required) {
      const challenge = await issueMfaToken(tx, deps, {
        userId: candidate.userId,
        factors,
        ip: input.ip,
      });

      // No device row and no session: both belong in the transaction that COMPLETES the login
      // (`completeMfaLogin`). A device row written here would make `isNewDevice` false by the time
      // the session opens, and §S11's new-device notification would never fire for an MFA user.
      // `users.last_login_at` is untouched for the same reason — this sign-in has not happened yet.
      await writeAudit(tx, {
        action: AUDIT_ACTIONS.MFA_CHALLENGED,
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: candidate.userId,
        subjectUserId: candidate.userId,
        ip: input.ip,
        userAgent: input.userAgent,
        metadata: {
          challengeId: challenge.challengeId,
          factorCount: challenge.factors.length,
          rehashed: verdict.rehashed,
        },
      });

      return {
        outcome: 'MFA_REQUIRED',
        mfaToken: challenge.mfaToken,
        expiresAt: challenge.expiresAt,
        factors: challenge.factors,
      };
    }

    const device = await upsertDevice(tx, {
      userId: candidate.userId,
      fingerprint: input.deviceFingerprint ?? null,
      ip: input.ip,
    });

    const session = await createSession(tx, deps, {
      userId: candidate.userId,
      // CONSUMER and only CONSUMER. Staff and logistics sign in through their own routes (T-037,
      // T-086); T-031's rule is that the scope is chosen where the session is created and can never
      // be changed by a refresh.
      scope: 'CONSUMER',
      amr: ['pwd'],
      deviceId: device.deviceId,
      ip: input.ip,
      userAgent: input.userAgent,
      isNewDevice: device.isNewDevice,
    });

    if (device.isNewDevice) {
      await publish(tx, identityDeviceSignedInEvent, {
        payload: {
          userId: candidate.userId,
          deviceId: device.deviceId,
          deviceLabel: deviceLabel(input.userAgent),
          location: signInLocation(input.ip),
          signedInAt: new Date().toISOString(),
          ip: input.ip,
        },
        aggregateType: 'identity.user',
        aggregateId: candidate.userId,
        actor: { type: 'CONSUMER', id: candidate.userId },
      });
    }

    await tx
      .update(users)
      .set({ lastLoginAt: sql`now()` })
      .where(eq(users.id, candidate.userId));

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.LOGIN,
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: candidate.userId,
      subjectUserId: candidate.userId,
      ip: input.ip,
      userAgent: input.userAgent,
      sessionId: session.sessionId,
      deviceId: device.deviceId,
      metadata: { amr: ['pwd'], rehashed: verdict.rehashed, isNewDevice: device.isNewDevice },
    });

    const { user, state } = await onboarding(tx, deps, candidate.userId);
    return { outcome: 'SESSION', session, user, nextStep: nextStep(state) };
  });
}

/**
 * The audit row and the risk event for a rejection.
 *
 * `reason` is written here and NEVER returned to the caller: Risk benefits from knowing that forty
 * failures on one identifier were all `wrong_password` rather than forty different unknown handles,
 * and the caller benefits from not being told which. That asymmetry is the whole point of §S3 — the
 * information exists, it simply does not leave the building.
 */
async function recordFailure(
  tx: Tx,
  input: LoginInput,
  candidate: LoginCandidate | null,
  verdict: string,
  usable: boolean,
): Promise<void> {
  const reason = !candidate ? 'unknown_identifier' : !usable ? 'status_not_usable' : verdict.toLowerCase();
  const kind = classifyIdentifier(input.identifier);
  const identifierHash = identifierDigest(input.identifier);

  await publish(tx, identityLoginFailedEvent, {
    payload: { identifierHash, identifierKind: kind, ip: input.ip, reason },
    aggregateType: 'identity.login',
    // No user to key the aggregate on when the identifier matched nobody; the hash is what Risk
    // groups by either way.
    ...(candidate ? { aggregateId: candidate.userId } : {}),
  });

  await writeAudit(tx, {
    action: AUDIT_ACTIONS.LOGIN_FAILED,
    outcome: 'FAILURE',
    actorType: candidate ? 'USER' : 'ANONYMOUS',
    actorUserId: candidate?.userId ?? null,
    subjectUserId: candidate?.userId ?? null,
    ip: input.ip,
    userAgent: input.userAgent,
    metadata: { identifierHash, identifierKind: kind, reason },
  });
}
