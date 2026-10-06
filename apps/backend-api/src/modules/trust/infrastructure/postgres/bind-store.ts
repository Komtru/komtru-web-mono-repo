// The real TrustStore: every SQL statement this module runs, and every transaction it opens.
//
// It is separated from the port (store.ts) so the services and jobs above can be tested against a
// hand-written stub, and so there is exactly one file to read when the question is "what does trust
// actually write". Nothing here decides anything — the rules are in `domain/` and in the services.
import { and, desc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../../../../db/index.js';
import { publish, type Tx } from '../../../../platform/events/publish.js';
import { fileRecords } from '../../../files/index.js';
import { applyVerificationLevel, users } from '../../../identity/index.js';
import {
  verificationDuplicateIdentityDetected,
  verificationLevelAttained,
  verificationLevelRevoked,
  verificationRejected,
  verificationSubmitted,
} from '../../domain/events.js';
import { levelName, levelNumber } from '../../domain/levels.js';
import type { IdentifierType, KycProvider } from './schema/enums.js';
import { bvnVerifications, ninVerifications } from './schema/identity-checks.js';
import { kycProviderCalls } from './schema/provider-calls.js';
import { livenessChecks } from './schema/liveness.js';
import { verificationLevelChanges } from './schema/level-changes.js';
import { verificationRequests, type VerificationRequest } from './schema/requests.js';
import type { ExpiredRequest, IdentityFactsRow, LevelOutcome, TrustStore } from './store.js';

/** Statuses that still hold the user's one in-flight slot (the partial unique index's predicate). */
const OPEN_STATUSES = ['SUBMITTED', 'PROVIDER_PENDING', 'MANUAL_REVIEW'] as const;

const outcomeTable = (type: IdentifierType) => (type === 'NIN' ? ninVerifications : bvnVerifications);

/**
 * Inserts the NIN or BVN outcome row.
 *
 * Written as a branch rather than `insert(outcomeTable(type))` because the two tables have
 * different columns — `dob_match` against `phone_match` — and a union of table types erases exactly
 * the check that catches writing one table's column into the other.
 */
async function insertIdentityOutcome(
  tx: Tx,
  input: {
    request: VerificationRequest;
    type: IdentifierType;
    masked: string;
    hash: Buffer;
    provider: KycProvider;
    providerReference: string;
    nameMatchScore?: number;
    dobMatch?: boolean;
    phoneMatch?: boolean;
    verified: boolean;
  },
): Promise<void> {
  const shared = {
    requestId: input.request.id,
    userId: input.request.userId,
    nameMatchScore: input.nameMatchScore?.toFixed(2) ?? null,
    provider: input.provider,
    providerReference: input.providerReference,
    verifiedAt: input.verified ? sql`now()` : null,
  };
  if (input.type === 'NIN') {
    await tx.insert(ninVerifications).values({
      ...shared,
      ninMasked: input.masked,
      ninHash: input.hash,
      dobMatch: input.dobMatch ?? null,
    });
    return;
  }
  await tx.insert(bvnVerifications).values({
    ...shared,
    bvnMasked: input.masked,
    bvnHash: input.hash,
    phoneMatch: input.phoneMatch ?? null,
  });
}

export function bindStore(db: Db): TrustStore {
  return {
    findSubject: async (userId) => {
      const [row] = await db
        .select({ status: users.status, verificationLevel: users.verificationLevel })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return row ? { userId, status: row.status, verificationLevel: row.verificationLevel } : undefined;
    },

    createRequest: async (input) =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .insert(verificationRequests)
          .values({
            userId: input.userId,
            verificationType: input.verificationType,
            targetLevel: input.targetLevel,
            attemptCount: input.attemptCount,
            selfieStorageRef: input.selfieStorageRef ?? null,
            // The database clock, so a TTL cannot be shortened or extended by a drifting instance.
            expiresAt: sql`now() + make_interval(mins => ${input.ttlMinutes})`,
          })
          .returning();
        if (!row) throw new Error('trust: the verification request was not written');

        await publish(tx, verificationSubmitted, {
          payload: { requestId: row.id, userId: row.userId, type: row.verificationType },
          aggregateType: 'verification_request',
          aggregateId: row.id,
        });
        return row;
      }),

    findRequest: async (requestId) => {
      const [row] = await db
        .select()
        .from(verificationRequests)
        .where(eq(verificationRequests.id, requestId))
        .limit(1);
      return row;
    },

    listOpenRequests: (userId) =>
      db
        .select()
        .from(verificationRequests)
        .where(
          and(
            eq(verificationRequests.userId, userId),
            inArray(verificationRequests.status, [...OPEN_STATUSES]),
          ),
        )
        .orderBy(desc(verificationRequests.submittedAt)),

    markProviderPending: async (requestId, provider) => {
      await db
        .update(verificationRequests)
        .set({ status: 'PROVIDER_PENDING', provider, providerCalledAt: sql`now()` })
        .where(eq(verificationRequests.id, requestId));
    },

    recordProviderCall: async (input) => {
      await db.insert(kycProviderCalls).values({
        requestId: input.requestId,
        provider: input.provider,
        callType: input.callType,
        latencyMs: input.latencyMs,
        succeeded: input.succeeded,
        httpStatus: input.httpStatus ?? null,
        errorKind: input.errorKind ?? null,
      });
    },

    applyIdentityOutcome: async (input) =>
      db.transaction(async (tx) => {
        await insertIdentityOutcome(tx, {
          request: input.request,
          type: input.type,
          masked: input.masked,
          hash: input.hash,
          provider: input.provider,
          providerReference: input.providerReference,
          ...(input.nameMatchScore === undefined ? {} : { nameMatchScore: input.nameMatchScore }),
          ...(input.dobMatch === undefined ? {} : { dobMatch: input.dobMatch }),
          ...(input.phoneMatch === undefined ? {} : { phoneMatch: input.phoneMatch }),
          verified: input.markVerified,
        });

        await tx
          .update(verificationRequests)
          .set({
            status: input.requestStatus,
            provider: input.provider,
            providerReference: input.providerReference,
            rejectionReason: input.rejectionReason ?? null,
            decidedAt: input.requestStatus === 'PROVIDER_PENDING' ? null : sql`now()`,
          })
          .where(eq(verificationRequests.id, input.request.id));

        if (input.requestStatus === 'REJECTED') {
          await publish(tx, verificationRejected, {
            payload: {
              requestId: input.request.id,
              userId: input.request.userId,
              type: input.type,
              reason: input.rejectionReason ?? 'rejected',
              attemptCount: input.request.attemptCount,
            },
            aggregateType: 'verification_request',
            aggregateId: input.request.id,
          });
        }
      }),

    applyDuplicateIdentity: async (input) =>
      db.transaction(async (tx) => {
        // No verified_at: the number stays unclaimed until a human says otherwise, so the rightful
        // owner is not locked out by someone else's attempt.
        await insertIdentityOutcome(tx, {
          request: input.request,
          type: input.type,
          masked: input.masked,
          hash: input.hash,
          provider: input.provider,
          providerReference: input.providerReference,
          ...(input.nameMatchScore === undefined ? {} : { nameMatchScore: input.nameMatchScore }),
          verified: false,
        });

        await tx
          .update(verificationRequests)
          .set({
            status: 'MANUAL_REVIEW',
            provider: input.provider,
            providerReference: input.providerReference,
            rejectionReason: null,
          })
          .where(eq(verificationRequests.id, input.request.id));

        await publish(tx, verificationDuplicateIdentityDetected, {
          payload: {
            identifierType: input.type,
            // Hex, not the number: two accounts correlating to one identifier is the fact a reviewer
            // needs, and establishing it does not require anyone to hold the number itself (D1).
            identifierHashHex: input.hash.toString('hex'),
            firstUserId: input.firstUserId,
            conflictingUserId: input.request.userId,
            requestId: input.request.id,
          },
          aggregateType: 'verification_request',
          aggregateId: input.request.id,
        });
      }),

    applyLivenessOutcome: async (input) =>
      db.transaction(async (tx) => {
        await tx.insert(livenessChecks).values({
          requestId: input.request.id,
          userId: input.request.userId,
          matchedAgainst: input.matchedAgainst,
          matchScore: input.matchScore.toFixed(2),
          livenessPassed: input.livenessPassed,
          selfieStorageRef: input.request.selfieStorageRef,
          provider: input.provider,
          providerReference: input.providerReference,
          failureReason: input.rejectionReason ?? null,
        });

        await tx
          .update(verificationRequests)
          .set({
            status: input.requestStatus,
            provider: input.provider,
            providerReference: input.providerReference,
            rejectionReason: input.rejectionReason ?? null,
            decidedAt: input.requestStatus === 'PROVIDER_PENDING' ? null : sql`now()`,
          })
          .where(eq(verificationRequests.id, input.request.id));

        if (input.requestStatus === 'REJECTED') {
          await publish(tx, verificationRejected, {
            payload: {
              requestId: input.request.id,
              userId: input.request.userId,
              type: 'LIVENESS',
              reason: input.rejectionReason ?? 'rejected',
              attemptCount: input.request.attemptCount,
            },
            aggregateType: 'verification_request',
            aggregateId: input.request.id,
          });
        }
      }),

    findIdentifierOwner: async (type, hash) => {
      const table = outcomeTable(type);
      const column = type === 'NIN' ? ninVerifications.ninHash : bvnVerifications.bvnHash;
      const [row] = await db
        .select({ userId: table.userId })
        .from(table)
        .where(and(eq(column, hash), isNotNull(table.verifiedAt)))
        .limit(1);
      return row?.userId;
    },

    identityFacts: async (userId): Promise<IdentityFactsRow> => {
      const [nin] = await db
        .select({ verifiedAt: ninVerifications.verifiedAt })
        .from(ninVerifications)
        .where(and(eq(ninVerifications.userId, userId), isNotNull(ninVerifications.verifiedAt)))
        .orderBy(desc(ninVerifications.verifiedAt))
        .limit(1);
      const [bvn] = await db
        .select({ verifiedAt: bvnVerifications.verifiedAt })
        .from(bvnVerifications)
        .where(and(eq(bvnVerifications.userId, userId), isNotNull(bvnVerifications.verifiedAt)))
        .orderBy(desc(bvnVerifications.verifiedAt))
        .limit(1);
      const [liveness] = await db
        .select({ checkedAt: livenessChecks.checkedAt })
        .from(livenessChecks)
        .where(and(eq(livenessChecks.userId, userId), eq(livenessChecks.livenessPassed, true)))
        .orderBy(desc(livenessChecks.checkedAt))
        .limit(1);
      const [attained] = await db
        .select({ occurredAt: verificationLevelChanges.occurredAt })
        .from(verificationLevelChanges)
        .where(
          and(eq(verificationLevelChanges.userId, userId), eq(verificationLevelChanges.direction, 'GRANT')),
        )
        .orderBy(desc(verificationLevelChanges.occurredAt))
        .limit(1);

      // The most recent of the two, so a liveness check is matched against the document the user
      // actually verified last rather than whichever table is queried first.
      const latest =
        nin?.verifiedAt && bvn?.verifiedAt
          ? nin.verifiedAt >= bvn.verifiedAt
            ? 'NIN'
            : 'BVN'
          : nin?.verifiedAt
            ? 'NIN'
            : bvn?.verifiedAt
              ? 'BVN'
              : undefined;

      return {
        identifierVerified: latest !== undefined,
        ...(latest ? { latestVerifiedIdentifier: latest } : {}),
        livenessPassed: liveness !== undefined,
        ...(attained?.occurredAt ? { levelAttainedAt: attained.occurredAt } : {}),
      };
    },

    grantLevel: (input) =>
      db.transaction(async (tx): Promise<LevelOutcome> => {
        const applied = await applyVerificationLevel(tx, {
          userId: input.userId,
          to: levelName(input.toLevel) as never,
          reason: input.reason,
        });
        const from = levelNumber(applied.from);
        // A grant to a level the user already holds writes nothing. A redelivered job must not
        // append a second row saying they moved from 2 to 2.
        if (!applied.changed || from >= input.toLevel) {
          return { changed: false, from, to: from };
        }

        await tx.insert(verificationLevelChanges).values({
          userId: input.userId,
          fromLevel: from,
          toLevel: input.toLevel,
          direction: 'GRANT',
          triggeringRequestId: input.triggeringRequestId ?? null,
          reason: input.reason,
          actorType: input.actorType,
          actorId: input.actorId ?? null,
        });

        await publish(tx, verificationLevelAttained, {
          payload: {
            userId: input.userId,
            level: input.toLevel,
            requestId: input.triggeringRequestId ?? null,
            provider: input.provider,
          },
          aggregateType: 'user',
          aggregateId: input.userId,
        });

        return { changed: true, from, to: input.toLevel };
      }),

    revokeLevel: (input) =>
      db.transaction(async (tx): Promise<LevelOutcome> => {
        const [row] = await tx
          .select({ verificationLevel: users.verificationLevel })
          .from(users)
          .where(eq(users.id, input.userId))
          .for('update')
          .limit(1);
        if (!row) throw new Error(`trust: no user ${input.userId} to revoke a level from`);
        const from = levelNumber(row.verificationLevel);
        if (from <= input.toLevel) return { changed: false, from, to: from };

        await applyVerificationLevel(tx, {
          userId: input.userId,
          to: levelName(input.toLevel) as never,
          reason: input.reason,
        });

        await tx.insert(verificationLevelChanges).values({
          userId: input.userId,
          fromLevel: from,
          toLevel: input.toLevel,
          direction: 'REVOKE',
          reason: input.reason,
          actorType: input.actorType,
          actorId: input.actorId ?? null,
        });

        await publish(tx, verificationLevelRevoked, {
          payload: { userId: input.userId, fromLevel: from, toLevel: input.toLevel, reason: input.reason },
          aggregateType: 'user',
          aggregateId: input.userId,
        });

        return { changed: true, from, to: input.toLevel };
      }),

    findKycSelfie: async (fileId) => {
      // Reached through M20's own table rather than a copy: the category and the uploader are facts
      // files owns, and the service above checks them. Only a READY, ACTIVE record is offered at all,
      // so a tombstoned selfie is indistinguishable from one that never existed (T-040's posture).
      const [row] = await db
        .select({
          id: fileRecords.id,
          uploaderUserId: fileRecords.uploaderUserId,
          category: fileRecords.category,
        })
        .from(fileRecords)
        .where(
          and(
            eq(fileRecords.id, fileId),
            eq(fileRecords.uploadState, 'READY'),
            eq(fileRecords.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      return row;
    },

    countAttempts: async (userId, verificationType) => {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(verificationRequests)
        .where(
          and(
            eq(verificationRequests.userId, userId),
            eq(verificationRequests.verificationType, verificationType as never),
          ),
        );
      return row?.count ?? 0;
    },

    expireStale: (now) =>
      db.transaction(async (tx): Promise<ExpiredRequest[]> => {
        /**
         * MANUAL_REVIEW is deliberately NOT swept.
         *
         * It is waiting on a person, not on a provider. Expiring it would silently close the case
         * T-052's review queue exists to work, and the user would be told their verification "timed
         * out" when in fact nobody looked at it.
         */
        const expired = await tx
          .update(verificationRequests)
          .set({ status: 'EXPIRED', decidedAt: sql`now()` })
          .where(
            and(
              lt(verificationRequests.expiresAt, now),
              inArray(verificationRequests.status, ['SUBMITTED', 'PROVIDER_PENDING']),
            ),
          )
          .returning({
            requestId: verificationRequests.id,
            userId: verificationRequests.userId,
            verificationType: verificationRequests.verificationType,
            attemptCount: verificationRequests.attemptCount,
          });

        for (const row of expired) {
          await publish(tx, verificationRejected, {
            payload: {
              requestId: row.requestId,
              userId: row.userId,
              type: row.verificationType,
              reason: 'The verification expired before we heard back from the provider',
              attemptCount: row.attemptCount,
            },
            aggregateType: 'verification_request',
            aggregateId: row.requestId,
          });
        }
        return expired;
      }),
  };
}

export type { VerificationRequest };
