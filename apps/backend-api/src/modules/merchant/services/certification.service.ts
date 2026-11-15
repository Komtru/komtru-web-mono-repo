// Certification and its end (T-055, design 6.3).
//
// `certifyApplication` is what approval does, and every part of it runs in the caller's transaction:
//   1. the MERCHANT capability goes ACTIVE, through identity's capability service
//   2. the `merchant_profiles` row exists, with `certified_at` and a unique storefront slug
//   3. the Verified Merchant badge is awarded
//   4. `merchant.profile.certified` is in the outbox
// A failure at any step rolls back all of it, so there is no merchant with a capability and no profile,
// or a badge with no capability. "Partial approval is a bug" is a property of the transaction, not a
// promise in a comment: the caller opens it, and a test makes the last step throw.
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { isUniqueViolation } from '../../../db/errors.js';
import { ApiError } from '../../../platform/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { activateCapability, revokeCapability, suspendCapability } from '../../identity/index.js';
import { slugCandidates } from '../domain/slug.js';
import { merchantCertificationRevoked, merchantCertified } from '../domain/events.js';
import type { MerchantApplication } from '../infrastructure/postgres/schema/applications.js';
import { merchantBadges, merchantProfiles } from '../infrastructure/postgres/schema/profiles.js';

export interface Certified {
  storefrontSlug: string;
  certifiedAt: Date;
}

export async function certifyApplication(
  tx: Tx,
  input: { application: MerchantApplication; actorUserId: string; reason: string },
): Promise<Certified> {
  const { application } = input;
  if (!application.businessName || !application.businessType) {
    // Unreachable for a submitted application (submit refuses an incomplete one); named so a caller
    // that bypasses it fails loudly rather than certifying a nameless shop.
    throw new Error('merchant: an application with no business name or type cannot be certified');
  }
  const certifiedAt = new Date();

  await activateCapability(tx, {
    userId: application.userId,
    capability: 'MERCHANT',
    grantedBy: input.actorUserId,
    reason: input.reason,
  });

  // A profile that already exists means certification was granted and then ended. Re-certifying is not
  // something the application queue decides (see `assertCanApply`), so approval refuses it rather than
  // quietly turning a suspension back off.
  const [existing] = await tx
    .select({ status: merchantProfiles.certificationStatus })
    .from(merchantProfiles)
    .where(eq(merchantProfiles.userId, application.userId))
    .for('update');
  if (existing) {
    throw new ApiError(
      409,
      'CONFLICT',
      'This account already has a merchant profile',
      'Re-certification is a separate decision.',
    );
  }
  const storefrontSlug = await insertProfile(tx, application, certifiedAt);

  await tx
    .insert(merchantBadges)
    .values({ userId: application.userId, badge: 'VERIFIED_MERCHANT', awardedAt: certifiedAt })
    // One live badge per user; a re-certification finds the one it has, and a revoked one is replaced.
    .onConflictDoNothing();

  await publish(tx, merchantCertified, {
    payload: {
      userId: application.userId,
      applicationId: application.id,
      storefrontSlug,
      certifiedAt: certifiedAt.toISOString(),
    },
    aggregateType: 'merchant.profile',
    aggregateId: application.userId,
    actor: { type: 'STAFF', id: input.actorUserId },
  });
  return { storefrontSlug, certifiedAt };
}

/**
 * Walks the slug candidates until an insert wins. Each attempt is its own savepoint, because a unique
 * violation aborts a Postgres transaction and the approval must survive losing a slug to a concurrent one.
 * The unique index decides; nothing reads first.
 */
async function insertProfile(tx: Tx, app: MerchantApplication, certifiedAt: Date): Promise<string> {
  const candidates = slugCandidates(app.businessName ?? 'shop');
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const slug = candidates.next().value;
    try {
      await tx.transaction(async (savepoint) => {
        await savepoint.insert(merchantProfiles).values({
          userId: app.userId,
          applicationId: app.id,
          businessName: app.businessName ?? '',
          businessType: app.businessType ?? 'REGISTERED_BUSINESS',
          storefrontSlug: slug,
          certifiedAt,
        });
      });
      return slug;
    } catch (error) {
      if (isUniqueViolation(error, 'merchant_profiles_slug_unique')) continue;
      throw error;
    }
  }
  throw new Error('merchant: no storefront slug was available after 50 attempts');
}

export type EndKind = 'SUSPENDED' | 'REVOKED';

/**
 * Suspension or revocation: the capability moves through identity (and buying is restored), the profile
 * and badge record it, and `merchant.profile.certification_revoked` tells listings, search and the
 * merchant. One transaction, the same as approval. Not behind an HTTP route in this ticket: the ticket
 * names none, and the caller is a staff decision elsewhere (risk, trust) that brings its own reason.
 */
export async function endCertification(
  db: Db,
  input: { userId: string; kind: EndKind; reason: string; actorUserId?: string | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [profile] = await tx
      .select()
      .from(merchantProfiles)
      .where(eq(merchantProfiles.userId, input.userId))
      .for('update');
    if (!profile || profile.certificationStatus === 'REVOKED') {
      throw new ApiError(409, 'CONFLICT', 'That account is not a certified merchant');
    }
    const end = input.kind === 'SUSPENDED' ? suspendCapability : revokeCapability;
    await end(tx, {
      userId: input.userId,
      capability: 'MERCHANT',
      reason: input.reason,
      actorUserId: input.actorUserId ?? null,
    });
    await tx
      .update(merchantProfiles)
      .set({
        certificationStatus: input.kind,
        certificationEndedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(merchantProfiles.userId, input.userId));
    await tx
      .update(merchantBadges)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(merchantBadges.userId, input.userId), isNull(merchantBadges.revokedAt)));
    await publish(tx, merchantCertificationRevoked, {
      payload: {
        userId: input.userId,
        kind: input.kind,
        reason: input.reason,
        revokedByUserId: input.actorUserId ?? null,
      },
      aggregateType: 'merchant.profile',
      aggregateId: input.userId,
      ...(input.actorUserId ? { actor: { type: 'STAFF' as const, id: input.actorUserId } } : {}),
    });
  });
}
