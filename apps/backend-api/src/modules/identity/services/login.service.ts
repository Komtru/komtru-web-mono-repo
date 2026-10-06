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
import { onboarding, type AccountDeps, type PublicUser } from './auth.service.js';
import { verifyAndRecord } from './credential.service.js';
import { deviceLabel, signInLocation, upsertDevice } from './device.service.js';
import { createSession, type IssuedSession } from './session.service.js';
import type { Tx } from '../../../platform/events/publish.js';

export type LoginResult =
  | { outcome: 'SESSION'; session: IssuedSession; user: PublicUser; nextStep: NextStep }
  /** The only failure. §S3: one status, one body, one cost, whatever actually went wrong. */
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

export async function login(db: Db, deps: AccountDeps, input: LoginInput): Promise<LoginResult> {
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
