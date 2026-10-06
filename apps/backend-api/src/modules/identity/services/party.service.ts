// Party lookup and username typeahead (M1 §8), the most privacy-sensitive endpoints in the module.
//
// §8.3 control 4 asks for a constant-time response and says "do not skip work on the miss path".
// That is the whole shape of `lookupParty`, and it is the same discipline `login.service.ts` applies
// to §S3: there is NO early return between the first line and the last. The budget is charged, the
// caller is checked, ONE statement resolves the party whatever the channel, the enrichment port is
// called whether or not anything was found, the velocity event is written either way — and only then
// does `partyVisible` decide what the caller is told. A miss, a user with `discoverable_by_email =
// false` and a suspended user all take that identical path and leave with the identical body, which
// is the property M1 §17 names for this endpoint.
//
// The residual asymmetry is the one SQL cannot remove: a query that finds a row fetches a heap tuple
// and one that does not, does not. `login.service.ts` accepted the same residue and bounded it by
// measurement rather than by argument; `party.enumeration.int.test.ts` is that measurement here.
import { and, eq, isNotNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { sha256 } from '../../../platform/crypto/hmac.js';
import { ApiError } from '../../../platform/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { identityPartyLookupPerformedEvent } from '../domain/events.js';
import { partyCard, type PartyCard, type PartyEnrichment, type PartyFacts } from '../domain/party/card.js';
import {
  MAX_TYPEAHEAD_RESULTS,
  canInviteOn,
  escapeLikePrefix,
  partyVisible,
  typeaheadPrefix,
  type Discoverability,
  type LookupKey,
} from '../domain/party/lookup.js';
import type { LookupBudget } from '../infrastructure/redis/lookup-budget.js';
import { userEmails, userPhones } from '../infrastructure/postgres/schema/contacts.js';
import { userCapabilities } from '../infrastructure/postgres/schema/rbac.js';
import { userProfiles, users } from '../infrastructure/postgres/schema/users.js';

export interface PartyPorts {
  /**
   * M7's completed-trade count, M5's merchant name and M20's signed avatar URL, keyed by user id.
   *
   * **Called unconditionally, including with an EMPTY list** — exactly as `verifyAndRecord` is
   * called with `userId: null` in `login.service.ts`. An implementation that returns early on an
   * empty list makes a found lookup cost one round trip more than a miss, which is precisely the
   * §8.3 control 4 oracle. Whoever supplies this (T-061, T-055) must issue its query either way.
   */
  enrich?: (tx: Tx, userIds: readonly string[]) => Promise<Map<string, PartyEnrichment>>;
}

export interface PartyDeps extends PartyPorts {
  db: Db;
  budget: LookupBudget;
}

export type LookupResult =
  | { found: true; party: PartyCard }
  /**
   * The ONE negative answer. There is no `reason`, no `hidden`, no `suspended`: a union with those
   * members is a union somebody eventually maps onto three different responses, which is the same
   * mistake `LoginResult` exists to make impossible.
   */
  | { found: false; canInvite: boolean; maskedHint: null };

export interface LookupInput {
  actorUserId: string;
  ip: string | null;
  key: LookupKey;
}

const NO_ENRICHMENT: PartyEnrichment = { completedTrades: 0, merchantName: null, avatarUrl: null };

interface PartyRow extends PartyFacts, Discoverability {
  userId: string;
}

/** §S12: Risk counts subjects; it never reads one. Channel-separated so a handle and an email that
 * happen to share text are two subjects, not one. */
const subjectDigest = (key: LookupKey): string =>
  sha256(`${key.channel}\u0000${key.canonical}`).toString('hex');

/**
 * §8.3 control 2, which is about the CALLER and not about the target.
 *
 * §8.3 asks for `verification_level >= CONTACT_VERIFIED`, and UNVERIFIED is the only level below
 * it, so that is what the comparison says — a rank table here would be a second copy of card.ts's.
 *
 * Deliberately a separate statement before the resolve, and deliberately the same 403 whatever was
 * asked for: a gate that answered 403 for an unverified caller asking about a real person and 404
 * for the same caller asking about nobody would be the oracle moved one layer up.
 */
export async function assertLookupEligible(tx: Tx, actorUserId: string): Promise<void> {
  const row = (
    await tx
      .select({ verificationLevel: users.verificationLevel, status: users.status })
      .from(users)
      .where(eq(users.id, actorUserId))
      .limit(1)
  )[0];

  if (!row || row.status !== 'ACTIVE' || row.verificationLevel === 'UNVERIFIED') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Verify your account to find people',
      'Confirm both your email address and your phone number, then try again.',
    );
  }
}

/**
 * Who, if anyone, this key names — in ONE statement for all three channels.
 *
 * A branch that looked up the email, and on a miss looked up the phone, would make a username miss
 * cost three round trips and an email hit one, which no amount of padding afterwards hides. Each
 * disjunct collapses to `false` when its parameter is absent, so the statement's shape is fixed and
 * only its parameters change.
 *
 * Contacts are joined on `verified_at IS NOT NULL` for the reason `resolveLoginCandidate` gives: an
 * unproven address is not unique, so resolving a counterparty through one would be ambiguous at best
 * and an impersonation at worst.
 *
 * **`username_history` is not consulted, and must never be.** A handle resolves only while its
 * current owner holds it. Reaching into the history table would resurrect a released handle — the
 * card of whoever used to own it — and would confirm that a quarantined handle exists, which is two
 * of T-033's rules broken at once.
 */
async function resolveParty(tx: Tx, key: LookupKey): Promise<PartyRow | null> {
  const username = key.channel === 'USERNAME' ? key.canonical : null;
  const emailNormal = key.channel === 'EMAIL' ? key.canonical : null;
  const phoneE164 = key.channel === 'PHONE' ? key.canonical : null;

  const row = (
    await tx
      .select({
        userId: users.id,
        publicId: users.publicId,
        username: users.username,
        displayName: userProfiles.displayName,
        avatarFileId: userProfiles.avatarFileId,
        verificationLevel: users.verificationLevel,
        createdAt: users.createdAt,
        status: users.status,
        discoverableByUsername: users.discoverableByUsername,
        discoverableByEmail: users.discoverableByEmail,
        discoverableByPhone: users.discoverableByPhone,
        merchantCapabilityStatus: userCapabilities.status,
        emailVerified: sql<boolean>`EXISTS (
          SELECT 1 FROM identity.user_emails ev
           WHERE ev.user_id = ${users.id} AND ev.verified_at IS NOT NULL)`,
        phoneVerified: sql<boolean>`EXISTS (
          SELECT 1 FROM identity.user_phones pv
           WHERE pv.user_id = ${users.id} AND pv.verified_at IS NOT NULL)`,
      })
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
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .leftJoin(
        userCapabilities,
        and(eq(userCapabilities.userId, users.id), eq(userCapabilities.capability, 'MERCHANT')),
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

export async function lookupParty(deps: PartyDeps, input: LookupInput): Promise<LookupResult> {
  // Before anything is read, and on every path: a budget charged only on a hit, or only on a miss,
  // tells the caller the answer through their own remaining quota.
  await deps.budget.charge(input.key.channel, [input.actorUserId, input.ip ?? '']);

  return deps.db.transaction(async (tx): Promise<LookupResult> => {
    await assertLookupEligible(tx, input.actorUserId);

    const row = await resolveParty(tx, input.key);
    const enrichment = await enrich(deps, tx, row ? [row.userId] : []);
    const visible = row !== null && partyVisible(row, input.key.channel);

    // §8.3 control 6, written on the miss path too — forty lookups with thirty-eight misses is the
    // pattern M13 is looking for, and it is invisible if only the hits are recorded.
    await publish(tx, identityPartyLookupPerformedEvent, {
      payload: {
        actorUserId: input.actorUserId,
        channel: input.key.channel,
        // `visible`, not `row !== null`: a hidden user is a miss as far as every observer is
        // concerned, including Risk, and recording otherwise would put the oracle in the outbox.
        found: visible,
        subjectHash: subjectDigest(input.key),
      },
      aggregateType: 'identity.user',
      aggregateId: input.actorUserId,
      actor: { type: 'CONSUMER', id: input.actorUserId },
    });

    if (!visible || !row) {
      return { found: false, canInvite: canInviteOn(input.key.channel), maskedHint: null };
    }
    return { found: true, party: partyCard(row, enrichment.get(row.userId) ?? NO_ENRICHMENT) };
  });
}

const enrich = async (
  deps: PartyDeps,
  tx: Tx,
  userIds: readonly string[],
): Promise<Map<string, PartyEnrichment>> => (await deps.enrich?.(tx, userIds)) ?? new Map();

/**
 * §8.4's typeahead — the deliberate exception, safe only because handles are public by design.
 *
 * Three characters minimum, PREFIX only (an infix search lets an attacker walk the namespace), eight
 * results maximum, and no pagination anywhere: a cursor here would hand back the walk that the
 * prefix rule removes.
 *
 * Two of §8.4's rules are inert until M7 exists. The ranking — prior counterparty with this user,
 * then shared merchant, then completed trade count — needs trade data, so the order is the handle's
 * own, which is at least stable. The exclusion rule's second half ("zero completed trades AND no
 * verification") is applied as its first half alone: an account at UNVERIFIED is excluded outright,
 * which starves impersonation accounts of visibility today and is strictly tighter than §8.4 asks
 * for. `enrich` is the seam for both.
 *
 * There is no `users_username_prefix_idx` — §8.4 specifies one and it is a migration this ticket may
 * not write — so this is a sequential scan bounded by LIMIT 8. See the ticket's deferred note.
 */
export async function suggestParties(
  deps: PartyDeps,
  input: { actorUserId: string; prefix: string },
): Promise<{ parties: PartyCard[] }> {
  const prefix = typeaheadPrefix(input.prefix);

  return deps.db.transaction(async (tx): Promise<{ parties: PartyCard[] }> => {
    await assertLookupEligible(tx, input.actorUserId);
    if (prefix === null) return { parties: [] };

    const rows = await tx
      .select({
        userId: users.id,
        publicId: users.publicId,
        username: users.username,
        displayName: userProfiles.displayName,
        avatarFileId: userProfiles.avatarFileId,
        verificationLevel: users.verificationLevel,
        createdAt: users.createdAt,
        merchantCapabilityStatus: userCapabilities.status,
        emailVerified: sql<boolean>`EXISTS (
          SELECT 1 FROM identity.user_emails ev
           WHERE ev.user_id = ${users.id} AND ev.verified_at IS NOT NULL)`,
        phoneVerified: sql<boolean>`EXISTS (
          SELECT 1 FROM identity.user_phones pv
           WHERE pv.user_id = ${users.id} AND pv.verified_at IS NOT NULL)`,
      })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .leftJoin(
        userCapabilities,
        and(eq(userCapabilities.userId, users.id), eq(userCapabilities.capability, 'MERCHANT')),
      )
      .where(
        and(
          // §8.4's own query shape: `lower(username::text)`, because text_pattern_ops has no citext
          // operator class and ILIKE on the citext column would not use the index §8.4 specifies.
          sql`lower(${users.username}::text) LIKE ${`${escapeLikePrefix(prefix)}%`} ESCAPE '\\'`,
          eq(users.status, 'ACTIVE'),
          eq(users.discoverableByUsername, true),
          sql`${users.verificationLevel} <> 'UNVERIFIED'`,
        ),
      )
      .orderBy(users.username)
      .limit(MAX_TYPEAHEAD_RESULTS);

    const enrichment = await enrich(
      deps,
      tx,
      rows.map((row) => row.userId),
    );
    return {
      parties: rows.map((row) => partyCard(row, enrichment.get(row.userId) ?? NO_ENRICHMENT)),
    };
  });
}
