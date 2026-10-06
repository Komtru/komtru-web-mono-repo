// Party invitations (M1 §8.5): the rows, the claim and the expiry sweep.
//
// The rule that shapes this file is §8.5 step 6 — "the invited channel must be the channel
// verified". A claim is therefore keyed on the DESTINATION and never on the token: whoever holds the
// link can forward it, and the person who receives it can register perfectly happily, but they only
// ever claim an invitation addressed to something they have proven they control. That is why
// `/auth/register`'s `invitationToken` binds an attribution and not a trade.
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import type { Encryption } from '../../../platform/crypto/encryption.js';
import type { HmacHasher } from '../../../platform/crypto/hmac.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { maskEmail, maskPhone } from '../../../platform/identifiers.js';
import type { Logger } from '../../../platform/logger.js';
import { canActAsBuyer } from '../domain/capability.js';
import {
  identityPartyInvitationClaimedEvent,
  identityPartyInvitationCreatedEvent,
  identityPartyInvitationExpiredEvent,
} from '../domain/events.js';
import {
  invitationChannelsFor,
  invitationDestinationHash,
  invitationExpiry,
  invitationTokenHash,
  issueInvitationToken,
  type InvitedRole,
} from '../domain/invitation.js';
import { lookupKeyForEmail, lookupKeyForPhone } from '../domain/party/lookup.js';
import { partyInvitations } from '../infrastructure/postgres/schema/invitations.js';
import { userCapabilities } from '../infrastructure/postgres/schema/rbac.js';
import { userProfiles, users } from '../infrastructure/postgres/schema/users.js';
import { findUserByVerifiedEmail, findUserByVerifiedPhone } from './contact.service.js';
import { assertLookupEligible } from './party.service.js';

export interface InvitationDeps {
  db: Db;
  /** The same pepper every other identity HMAC uses, under this module's own domain. */
  hasher: HmacHasher;
  encryption: Encryption;
  logger: Logger;
  now?: () => Date;
}

export interface CreateInvitationInput {
  inviterUserId: string;
  channel: 'EMAIL' | 'PHONE';
  destination: string;
  intendedRole: InvitedRole;
  context?: { type: string; id: string };
}

export type CreateInvitationResult =
  | {
      outcome: 'CREATED';
      invitationId: string;
      token: string;
      maskedDestination: string;
      expiresAt: Date;
    }
  | { outcome: 'INVALID_DESTINATION' }
  /** The inviter's own verified address. Not an enumeration leak: it is a fact about the caller. */
  | { outcome: 'SELF' };

/**
 * §8.5 step 2.
 *
 * The caller is held to §8.3 control 2, exactly as on the lookup this endpoint follows (§8.1 draws
 * invite as the continuation of a lookup miss). Without that gate a brand-new unverified account —
 * one every lookup route refuses — could post ten invitations a minute to arbitrary addresses, each
 * writing a third party's contact into our table, and would become an outbound relay the moment a
 * later ticket teaches notify to address a raw destination.
 *
 * **It deliberately does NOT check whether the destination already belongs to somebody else, and it
 * never claims on creation.** A lookup miss can be a live account with `discoverable_by_email =
 * false`, and binding that person to a trade on the strength of an address they asked not to be
 * found by would defeat the flag the lookup honoured one endpoint earlier. Such an invitation sits
 * PENDING and expires in fourteen days, and M7 cancels — which is the honest outcome, and is also
 * why the response here carries no status a caller could read existence off.
 */
export async function createInvitation(
  deps: InvitationDeps,
  input: CreateInvitationInput,
): Promise<CreateInvitationResult> {
  const key =
    input.channel === 'EMAIL' ? lookupKeyForEmail(input.destination) : lookupKeyForPhone(input.destination);
  if (!key) return { outcome: 'INVALID_DESTINATION' };

  const now = deps.now?.() ?? new Date();
  const { token, tokenHash } = issueInvitationToken();
  const destinationHash = invitationDestinationHash(deps.hasher, key.canonical);
  const masked = input.channel === 'EMAIL' ? maskEmail(input.destination) : maskPhone(key.canonical);

  return deps.db.transaction(async (tx): Promise<CreateInvitationResult> => {
    await assertLookupEligible(tx, input.inviterUserId);

    // The one existence check that leaks nothing, because it is about the caller: inviting yourself
    // would create a counterparty that is you, which is design C5's self-dealing block at the
    // cheapest possible layer.
    const owner =
      input.channel === 'EMAIL'
        ? await findUserByVerifiedEmail(tx, key.canonical)
        : await findUserByVerifiedPhone(tx, key.canonical);
    if (owner?.userId === input.inviterUserId) return { outcome: 'SELF' };

    const expiresAt = invitationExpiry(now);
    const row = (
      await tx
        .insert(partyInvitations)
        .values({
          inviterUserId: input.inviterUserId,
          channel: input.channel === 'EMAIL' ? 'EMAIL' : 'SMS',
          destinationHash,
          destinationMasked: masked,
          // The DELIVERABLE address, not the canonical one: `jane+shop@gmail.com` canonicalises to
          // `jane@gmail.com` for matching, and silently rewriting a person's address is its own bug
          // (platform/identifiers.ts says so about `emailNormal`, and it is true here).
          destinationEnc: deps.encryption.seal(input.destination.trim()),
          intendedRole: input.intendedRole,
          contextType: input.context?.type ?? null,
          contextId: input.context?.id ?? null,
          tokenHash,
          expiresAt,
        })
        .returning({ id: partyInvitations.id })
    )[0];
    if (!row) throw new Error('createInvitation: the insert returned no row');

    await publish(tx, identityPartyInvitationCreatedEvent, {
      payload: {
        invitationId: row.id,
        inviterUserId: input.inviterUserId,
        channel: input.channel,
        maskedDestination: masked,
        intendedRole: input.intendedRole,
        contextType: input.context?.type ?? null,
        contextId: input.context?.id ?? null,
        expiresAt: expiresAt.toISOString(),
      },
      aggregateType: 'identity.party_invitation',
      aggregateId: row.id,
      actor: { type: 'CONSUMER', id: input.inviterUserId },
    });

    return { outcome: 'CREATED', invitationId: row.id, token, maskedDestination: masked, expiresAt };
  });
}

export interface InvitationPreview {
  status: string;
  intendedRole: InvitedRole;
  maskedDestination: string;
  inviterUsername: string | null;
  inviterDisplayName: string | null;
  contextType: string | null;
  expiresAt: Date;
}

/**
 * What the claim link renders. Keyed on 256 bits of randomness, so there is nothing to enumerate and
 * no session to require — the holder of the link is the audience.
 *
 * `contextId` is NOT returned: a trade id is the inviter's and M7's, and the person reading the
 * invitation has no use for it before they have an account.
 */
export async function previewInvitation(
  deps: InvitationDeps,
  token: string,
): Promise<InvitationPreview | null> {
  const row = (
    await deps.db
      .select({
        status: partyInvitations.status,
        intendedRole: partyInvitations.intendedRole,
        maskedDestination: partyInvitations.destinationMasked,
        contextType: partyInvitations.contextType,
        expiresAt: partyInvitations.expiresAt,
        inviterUsername: users.username,
        inviterDisplayName: userProfiles.displayName,
      })
      .from(partyInvitations)
      .innerJoin(users, eq(users.id, partyInvitations.inviterUserId))
      .leftJoin(userProfiles, eq(userProfiles.userId, partyInvitations.inviterUserId))
      .where(eq(partyInvitations.tokenHash, invitationTokenHash(token)))
      .limit(1)
  )[0];

  return row ? { ...row, intendedRole: row.intendedRole as InvitedRole } : null;
}

/** The row `/auth/register` binds an attribution to: live, unclaimed and unexpired, or nothing. */
export async function resolveInvitationToken(tx: Tx, token: string): Promise<{ id: string } | null> {
  const row = (
    await tx
      .select({ id: partyInvitations.id })
      .from(partyInvitations)
      .where(
        and(
          eq(partyInvitations.tokenHash, invitationTokenHash(token)),
          eq(partyInvitations.status, 'PENDING'),
          sql`${partyInvitations.expiresAt} > now()`,
        ),
      )
      .limit(1)
  )[0];
  return row ?? null;
}

/**
 * §8.5 steps 5 and 6: a channel was just proven, so every live invitation addressed to it is claimed.
 *
 * Three rules beyond the destination match, two of which §8.5 does not spell out:
 *
 *   - the inviter may not claim their own invitation. Verifying a second address you invited
 *     yourself from would make you both parties to the trade, which is design C5's self-dealing
 *     block;
 *   - a certified merchant may not claim a BUYER invitation. Design §6.3 names
 *     `CLAIM_BUYER_INVITATION` as one of the six buyer paths, and this is where it is checked;
 *   - the discovery flags are NOT consulted. They govern being FOUND by an address; this person is
 *     proving the address themselves, which is a different act and their own.
 */
export async function claimInvitationsForDestination(
  tx: Tx,
  deps: Pick<InvitationDeps, 'hasher'>,
  input: { userId: string; channel: 'EMAIL' | 'PHONE'; canonical: string },
): Promise<number> {
  const merchant = (
    await tx
      .select({ status: userCapabilities.status })
      .from(userCapabilities)
      .where(and(eq(userCapabilities.userId, input.userId), eq(userCapabilities.capability, 'MERCHANT')))
      .limit(1)
  )[0];

  const claimable: InvitedRole[] = canActAsBuyer(merchant?.status ?? null) ? ['BUYER', 'SELLER'] : ['SELLER'];

  const claimed = await tx
    .update(partyInvitations)
    .set({ status: 'CLAIMED', claimedByUserId: input.userId, claimedAt: sql`now()` })
    .where(
      and(
        eq(partyInvitations.status, 'PENDING'),
        sql`${partyInvitations.expiresAt} > now()`,
        eq(partyInvitations.destinationHash, invitationDestinationHash(deps.hasher, input.canonical)),
        inArray(partyInvitations.channel, invitationChannelsFor(input.channel)),
        sql`${partyInvitations.inviterUserId} <> ${input.userId}`,
        inArray(partyInvitations.intendedRole, claimable),
      ),
    )
    .returning({
      id: partyInvitations.id,
      inviterUserId: partyInvitations.inviterUserId,
      intendedRole: partyInvitations.intendedRole,
      contextType: partyInvitations.contextType,
      contextId: partyInvitations.contextId,
    });

  for (const row of claimed) {
    await publish(tx, identityPartyInvitationClaimedEvent, {
      payload: {
        invitationId: row.id,
        inviterUserId: row.inviterUserId,
        claimedByUserId: input.userId,
        intendedRole: row.intendedRole as InvitedRole,
        contextType: row.contextType,
        contextId: row.contextId,
      },
      aggregateType: 'identity.party_invitation',
      aggregateId: row.id,
      actor: { type: 'CONSUMER', id: input.userId },
    });
  }

  return claimed.length;
}

/**
 * §8.5 step 7, run daily. The event is not optional: without it M7 has no trigger and the trade
 * hangs in PENDING_COUNTERPARTY forever.
 *
 * Batched with `FOR UPDATE SKIP LOCKED` so two workers can run it without either blocking, and so a
 * backlog does not become one transaction holding a lock on every expired invitation at once.
 */
export async function expireInvitations(
  db: Db,
  options: { batch?: number } = {},
): Promise<{ expired: number }> {
  const batch = options.batch ?? 200;
  let expired = 0;

  for (;;) {
    const swept = await db.transaction(async (tx) => {
      const due = sql`(
        SELECT id FROM identity.party_invitations
         WHERE status = 'PENDING' AND expires_at <= now()
         ORDER BY expires_at
         LIMIT ${batch}
         FOR UPDATE SKIP LOCKED)`;

      const rows = await tx
        .update(partyInvitations)
        .set({ status: 'EXPIRED' })
        .where(sql`${partyInvitations.id} IN ${due}`)
        .returning({
          id: partyInvitations.id,
          inviterUserId: partyInvitations.inviterUserId,
          intendedRole: partyInvitations.intendedRole,
          contextType: partyInvitations.contextType,
          contextId: partyInvitations.contextId,
        });

      for (const row of rows) {
        await publish(tx, identityPartyInvitationExpiredEvent, {
          payload: {
            invitationId: row.id,
            inviterUserId: row.inviterUserId,
            intendedRole: row.intendedRole as InvitedRole,
            contextType: row.contextType,
            contextId: row.contextId,
          },
          aggregateType: 'identity.party_invitation',
          aggregateId: row.id,
        });
      }
      return rows.length;
    });

    expired += swept;
    if (swept < batch) return { expired };
  }
}
