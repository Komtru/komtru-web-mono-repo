// The real TrustStore: every SQL statement this module runs, and every transaction it opens.
//
// It is separated from the port (store.ts) so the services and jobs above can be tested against a
// hand-written stub, and so there is exactly one file to read when the question is "what does trust
// actually write". Nothing here decides anything — the rules are in `domain/` and in the services.
import { and, count, desc, eq, inArray, isNotNull, lt, sql, type SQL } from 'drizzle-orm';
import { TransactionRollbackError } from 'drizzle-orm/errors';
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
import { decideLevelChange, levelName, levelNumber } from '../../domain/levels.js';
import { bankAccountNameMatches, businessVerifications } from './schema/business.js';
import { addressChecks, verificationDocuments } from './schema/documents.js';
import { socialProofClaims } from './schema/social-proof.js';
import type { IdentifierType, KycProvider, VerificationRequestStatus } from './schema/enums.js';
import { bvnVerifications, ninVerifications } from './schema/identity-checks.js';
import { kycProviderCalls } from './schema/provider-calls.js';
import { livenessChecks } from './schema/liveness.js';
import { verificationLevelChanges } from './schema/level-changes.js';
import { verificationRequests, type VerificationRequest } from './schema/requests.js';
import type {
  BusinessFactsRow,
  BusinessOutcomeInput,
  DuplicateBusinessInput,
  ExpiredRequest,
  IdentityFactsRow,
  LevelOutcome,
  RejectedRequestRow,
  TrustStore,
} from './store.js';

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
    verifiedFirstName?: string;
    verifiedLastName?: string;
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
    // Kept only for a passed check: a rejected attempt's typed name is exactly what must not be trusted.
    verifiedFirstName: input.verified ? (input.verifiedFirstName ?? null) : null,
    verifiedLastName: input.verified ? (input.verifiedLastName ?? null) : null,
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

/**
 * The caller's current level, with the row locked for the rest of the transaction.
 *
 * Both level paths take it, in the same order (users, then the change log), so two grants landing at
 * once serialise rather than deadlock.
 */
async function lockLevel(tx: Tx, userId: string): Promise<number> {
  const [row] = await tx
    .select({ verificationLevel: users.verificationLevel })
    .from(users)
    .where(eq(users.id, userId))
    .for('update')
    .limit(1);
  if (!row) throw new Error(`trust: no user ${userId} to change a verification level on`);
  return levelNumber(row.verificationLevel);
}

/** `decided_at` is for a request that was actually decided; one still in flight has not been. */
const decidedAtFor = (status: VerificationRequestStatus): SQL | null =>
  status === 'PROVIDER_PENDING' || status === 'MANUAL_REVIEW' ? null : sql`now()`;

/**
 * True when the transaction committed, false when it rolled itself back because the request had
 * already been decided elsewhere.
 *
 * `tx.rollback()` throws a `TransactionRollbackError` by design in drizzle; catching exactly that
 * turns "somebody else got there first" back into a value the caller can branch on, while any real
 * failure still propagates and fails the job.
 */
async function applied(work: Promise<unknown>): Promise<boolean> {
  try {
    await work;
    return true;
  } catch (error) {
    if (error instanceof TransactionRollbackError) return false;
    throw error;
  }
}

/**
 * Moves the umbrella request, returning false when it had already left the open set.
 *
 * Every T-051 outcome needs exactly this and the identity paths each spelled it out inline. One copy,
 * because the thing it guards is subtle: a job reads the status once and then spends seconds inside
 * a provider call, so a blind `UPDATE … WHERE id = $1` would overwrite a request the sweep had
 * already EXPIRED with APPROVED, and go on to grant a level the sweep denied.
 */
async function moveRequest(
  tx: Tx,
  input: {
    requestId: string;
    status: VerificationRequestStatus;
    provider: KycProvider;
    providerReference: string;
    rejectionReason?: string | undefined;
  },
): Promise<boolean> {
  const moved = await tx
    .update(verificationRequests)
    .set({
      status: input.status,
      provider: input.provider,
      providerReference: input.providerReference,
      rejectionReason: input.rejectionReason ?? null,
      decidedAt: decidedAtFor(input.status),
    })
    .where(
      and(
        eq(verificationRequests.id, input.requestId),
        inArray(verificationRequests.status, [...OPEN_STATUSES]),
      ),
    )
    .returning({ id: verificationRequests.id });
  return moved.length > 0;
}

/** The `business_verifications` insert both the ordinary and the duplicate CAC path make. */
async function insertBusinessOutcome(
  tx: Tx,
  input: BusinessOutcomeInput | DuplicateBusinessInput,
  verified: boolean,
): Promise<void> {
  await tx.insert(businessVerifications).values({
    requestId: input.request.id,
    userId: input.request.userId,
    cacRcNumber: input.cacRcNumber,
    registeredBusinessName: input.registeredBusinessName,
    businessType: input.businessType ?? null,
    cacStatus: input.cacStatus ?? null,
    officersMatch: input.officersMatch ?? null,
    provider: input.provider,
    providerReference: input.providerReference,
    verifiedAt: verified ? sql`now()` : null,
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
      // SUBMITTED only, not every open status: a MANUAL_REVIEW request dragged back to
      // PROVIDER_PENDING by a redelivered job becomes sweepable, which silently closes the human
      // case `expireStale` goes out of its way to protect.
      const moved = await db
        .update(verificationRequests)
        .set({ status: 'PROVIDER_PENDING', provider, providerCalledAt: sql`now()` })
        .where(
          and(
            eq(verificationRequests.id, requestId),
            inArray(verificationRequests.status, ['SUBMITTED', 'PROVIDER_PENDING']),
          ),
        )
        .returning({ id: verificationRequests.id });
      return moved.length > 0;
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
      applied(
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
            ...(input.verifiedFirstName === undefined ? {} : { verifiedFirstName: input.verifiedFirstName }),
            ...(input.verifiedLastName === undefined ? {} : { verifiedLastName: input.verifiedLastName }),
            verified: input.markVerified,
          });

          const moved = await tx
            .update(verificationRequests)
            .set({
              status: input.requestStatus,
              provider: input.provider,
              providerReference: input.providerReference,
              rejectionReason: input.rejectionReason ?? null,
              decidedAt: decidedAtFor(input.requestStatus),
            })
            .where(
              and(
                eq(verificationRequests.id, input.request.id),
                inArray(verificationRequests.status, [...OPEN_STATUSES]),
              ),
            )
            .returning({ id: verificationRequests.id });
          // Roll the outcome row back with it: a `nin_verifications` row whose request was expired by
          // the sweep is an orphan that the uniqueness index would still honour.
          if (moved.length === 0) tx.rollback();

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
      ),

    applyDuplicateIdentity: async (input) =>
      applied(
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

          const moved = await tx
            .update(verificationRequests)
            .set({
              status: 'MANUAL_REVIEW',
              provider: input.provider,
              providerReference: input.providerReference,
              rejectionReason: null,
            })
            .where(
              and(
                eq(verificationRequests.id, input.request.id),
                inArray(verificationRequests.status, [...OPEN_STATUSES]),
              ),
            )
            .returning({ id: verificationRequests.id });
          if (moved.length === 0) tx.rollback();

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
      ),

    applyLivenessOutcome: async (input) =>
      applied(
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

          const moved = await tx
            .update(verificationRequests)
            .set({
              status: input.requestStatus,
              provider: input.provider,
              providerReference: input.providerReference,
              rejectionReason: input.rejectionReason ?? null,
              decidedAt: decidedAtFor(input.requestStatus),
            })
            .where(
              and(
                eq(verificationRequests.id, input.request.id),
                inArray(verificationRequests.status, [...OPEN_STATUSES]),
              ),
            )
            .returning({ id: verificationRequests.id });
          if (moved.length === 0) tx.rollback();

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
      ),

    settleAlreadyVerified: async (input) => {
      const settled = await db
        .update(verificationRequests)
        .set({
          status: 'APPROVED',
          provider: input.provider,
          providerReference: input.providerReference,
          decidedAt: sql`now()`,
        })
        .where(
          and(
            eq(verificationRequests.id, input.request.id),
            inArray(verificationRequests.status, [...OPEN_STATUSES]),
          ),
        )
        .returning({ id: verificationRequests.id });
      return settled.length > 0;
    },

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

    findVerifiedIdentityName: async (userId) => {
      const [nin] = await db
        .select({
          firstName: ninVerifications.verifiedFirstName,
          lastName: ninVerifications.verifiedLastName,
          verifiedAt: ninVerifications.verifiedAt,
        })
        .from(ninVerifications)
        .where(
          and(
            eq(ninVerifications.userId, userId),
            isNotNull(ninVerifications.verifiedAt),
            isNotNull(ninVerifications.verifiedFirstName),
            isNotNull(ninVerifications.verifiedLastName),
          ),
        )
        .orderBy(desc(ninVerifications.verifiedAt))
        .limit(1);
      const [bvn] = await db
        .select({
          firstName: bvnVerifications.verifiedFirstName,
          lastName: bvnVerifications.verifiedLastName,
          verifiedAt: bvnVerifications.verifiedAt,
        })
        .from(bvnVerifications)
        .where(
          and(
            eq(bvnVerifications.userId, userId),
            isNotNull(bvnVerifications.verifiedAt),
            isNotNull(bvnVerifications.verifiedFirstName),
            isNotNull(bvnVerifications.verifiedLastName),
          ),
        )
        .orderBy(desc(bvnVerifications.verifiedAt))
        .limit(1);
      const latest = nin && bvn ? (nin.verifiedAt! >= bvn.verifiedAt! ? nin : bvn) : (nin ?? bvn);
      return latest?.firstName && latest.lastName
        ? { firstName: latest.firstName, lastName: latest.lastName }
        : undefined;
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

      const verifiedTypes: IdentifierType[] = [];
      if (nin?.verifiedAt) verifiedTypes.push('NIN');
      if (bvn?.verifiedAt) verifiedTypes.push('BVN');

      return {
        identifierVerified: latest !== undefined,
        verifiedTypes,
        ...(latest ? { latestVerifiedIdentifier: latest } : {}),
        livenessPassed: liveness !== undefined,
        ...(attained?.occurredAt ? { levelAttainedAt: attained.occurredAt } : {}),
      };
    },

    /**
     * Reads the level under a row lock, asks `decideLevelChange`, and only then writes.
     *
     * The order matters and an earlier version had it wrong: it called `applyVerificationLevel`
     * first and checked "already at or above" afterwards, so a redelivered level-2 grant reaching a
     * BUSINESS_VERIFIED user committed the DOWNGRADE and appended no row to explain it. Deciding
     * before writing makes that unrepresentable rather than merely unlikely.
     */
    grantLevel: (input) =>
      db.transaction(async (tx): Promise<LevelOutcome> => {
        const from = await lockLevel(tx, input.userId);
        if (!decideLevelChange({ from, to: input.toLevel, direction: 'GRANT' }).apply) {
          return { changed: false, from, to: from };
        }

        await applyVerificationLevel(tx, {
          userId: input.userId,
          to: levelName(input.toLevel),
          reason: input.reason,
        });

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
        const from = await lockLevel(tx, input.userId);
        if (!decideLevelChange({ from, to: input.toLevel, direction: 'REVOKE' }).apply) {
          return { changed: false, from, to: from };
        }

        await applyVerificationLevel(tx, {
          userId: input.userId,
          to: levelName(input.toLevel),
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

    // --- T-051: business, bank name-match, address, social proof --------------------------------

    applyBusinessOutcome: async (input) =>
      applied(
        db.transaction(async (tx) => {
          await insertBusinessOutcome(tx, input, input.markVerified);
          // Rolls the outcome row back with the request: a `business_verifications` row whose
          // request the sweep expired is an orphan the user-active unique index would still honour,
          // which would then refuse the resubmission BVR1 invites.
          if (
            !(await moveRequest(tx, {
              requestId: input.request.id,
              status: input.requestStatus,
              provider: input.provider,
              providerReference: input.providerReference,
              rejectionReason: input.rejectionReason,
            }))
          ) {
            tx.rollback();
          }

          if (input.requestStatus === 'REJECTED') {
            await publish(tx, verificationRejected, {
              payload: {
                requestId: input.request.id,
                userId: input.request.userId,
                type: 'CAC',
                reason: input.rejectionReason ?? 'rejected',
                attemptCount: input.request.attemptCount,
              },
              aggregateType: 'verification_request',
              aggregateId: input.request.id,
            });
          }
        }),
      ),

    applyDuplicateBusiness: async (input) =>
      applied(
        db.transaction(async (tx) => {
          // No `verified_at`: the registration stays unclaimed until a human says otherwise, so the
          // real company is not locked out of level 3 by somebody else's attempt on its RC number.
          await insertBusinessOutcome(tx, input, false);
          if (
            !(await moveRequest(tx, {
              requestId: input.request.id,
              status: 'MANUAL_REVIEW',
              provider: input.provider,
              providerReference: input.providerReference,
            }))
          ) {
            tx.rollback();
          }

          await publish(tx, verificationDuplicateIdentityDetected, {
            payload: {
              identifierType: 'CAC',
              /**
               * Hashed, even though an RC number is public record and sits in the clear in the
               * column beside it (§6.5).
               *
               * `identifierHashHex` is one field with one meaning across every type a consumer
               * reads it for. A plain RC number here and a keyed HMAC there would be two shapes
               * behind one name, and a consumer correlating across types would quietly never match.
               */
              identifierHashHex: input.rcNumberHashHex,
              firstUserId: input.firstUserId,
              conflictingUserId: input.request.userId,
              requestId: input.request.id,
            },
            aggregateType: 'verification_request',
            aggregateId: input.request.id,
          });
        }),
      ),

    applyBankMatchOutcome: async (input) =>
      applied(
        db.transaction(async (tx) => {
          await tx.insert(bankAccountNameMatches).values({
            requestId: input.request.id,
            userId: input.request.userId,
            accountNumberMasked: input.accountNumberMasked,
            accountNumberHash: input.accountNumberHash,
            bankCode: input.bankCode,
            resolvedAccountName: input.resolvedAccountName ?? null,
            expectedName: input.expectedName,
            matchResult: input.matchResult,
            matchScore: input.matchScore?.toFixed(2) ?? null,
            provider: input.provider,
            providerReference: input.providerReference,
          });

          if (
            !(await moveRequest(tx, {
              requestId: input.request.id,
              status: input.requestStatus,
              provider: input.provider,
              providerReference: input.providerReference,
              rejectionReason: input.rejectionReason,
            }))
          ) {
            tx.rollback();
          }

          if (input.requestStatus === 'REJECTED') {
            await publish(tx, verificationRejected, {
              payload: {
                requestId: input.request.id,
                userId: input.request.userId,
                type: 'BANK_ACCOUNT_NAME_MATCH',
                reason: input.rejectionReason ?? 'rejected',
                attemptCount: input.request.attemptCount,
              },
              aggregateType: 'verification_request',
              aggregateId: input.request.id,
            });
          }
        }),
      ),

    findBusinessOwner: async (rcNumber) => {
      // Verified rows only (§7). "Has any user ever typed this number" is the wrong question: a
      // rejected attempt by a fraudster would otherwise lock the real company out of its own RC.
      const [row] = await db
        .select({
          userId: businessVerifications.userId,
          registeredBusinessName: businessVerifications.registeredBusinessName,
        })
        .from(businessVerifications)
        .where(
          and(eq(businessVerifications.cacRcNumber, rcNumber), isNotNull(businessVerifications.verifiedAt)),
        )
        .orderBy(desc(businessVerifications.verifiedAt))
        .limit(1);
      return row;
    },

    findVerifiedBusiness: async (userId) => {
      const [row] = await db
        .select({
          cacRcNumber: businessVerifications.cacRcNumber,
          registeredBusinessName: businessVerifications.registeredBusinessName,
        })
        .from(businessVerifications)
        .where(and(eq(businessVerifications.userId, userId), isNotNull(businessVerifications.verifiedAt)))
        .limit(1);
      return row;
    },

    businessFacts: async (userId): Promise<BusinessFactsRow> => {
      const [subject] = await db
        .select({ verificationLevel: users.verificationLevel })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const [cac] = await db
        .select({ id: businessVerifications.id })
        .from(businessVerifications)
        .where(and(eq(businessVerifications.userId, userId), isNotNull(businessVerifications.verifiedAt)))
        .limit(1);
      /**
       * `EXACT` only, and on an APPROVED request.
       *
       * `FUZZY_MATCH` deliberately does not count (`decideBankMatchOutcome`), and the join to the
       * request is what stops a row written against a request a human later rejected from still
       * reading as a pass — the outcome row is insert-only, so the request is the record of the
       * decision.
       */
      const [bank] = await db
        .select({ id: bankAccountNameMatches.id })
        .from(bankAccountNameMatches)
        .innerJoin(verificationRequests, eq(bankAccountNameMatches.requestId, verificationRequests.id))
        .where(
          and(
            eq(bankAccountNameMatches.userId, userId),
            eq(bankAccountNameMatches.matchResult, 'EXACT'),
            eq(verificationRequests.status, 'APPROVED'),
          ),
        )
        .limit(1);

      return {
        // 0 rather than a throw: `businessFacts` runs on `GET /verification/status`, and a read path
        // that throws because the user row vanished mid-request is a 500 on the screen whose job is
        // to explain where the user stands. `findSubject` above it has already answered that.
        currentLevel: subject ? levelNumber(subject.verificationLevel) : 0,
        cacVerified: cac !== undefined,
        businessBankMatched: bank !== undefined,
      };
    },

    findBankNameMatch: async (input) => {
      const [row] = await db
        .select({
          id: bankAccountNameMatches.id,
          matchResult: bankAccountNameMatches.matchResult,
          resolvedAccountName: bankAccountNameMatches.resolvedAccountName,
          expectedName: bankAccountNameMatches.expectedName,
          checkedAt: bankAccountNameMatches.checkedAt,
        })
        .from(bankAccountNameMatches)
        .where(
          and(
            eq(bankAccountNameMatches.userId, input.userId),
            eq(bankAccountNameMatches.bankCode, input.bankCode),
            eq(bankAccountNameMatches.accountNumberHash, input.accountNumberHash),
          ),
        )
        // The most recent check on that account: T-073 asks what we know NOW, and a seller who
        // moved an account into the business name must not be answered with the old mismatch.
        .orderBy(desc(bankAccountNameMatches.checkedAt))
        .limit(1);
      return row;
    },

    createAddressCheck: (input) =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .insert(verificationRequests)
          .values({
            userId: input.userId,
            verificationType: 'ADDRESS',
            /**
             * Straight to MANUAL_REVIEW, not SUBMITTED.
             *
             * §6.6 gives `address_checks` no provider columns, so nothing is going to call anybody
             * about this — there is no job and no webhook. A request parked in SUBMITTED would be
             * swept by `expireStale` within the day and the user told their address proof "timed
             * out" when in fact it was waiting for a person the whole time.
             */
            status: 'MANUAL_REVIEW',
            targetLevel: input.targetLevel,
            attemptCount: input.attemptCount,
            expiresAt: sql`now() + make_interval(mins => ${input.ttlMinutes})`,
          })
          .returning();
        if (!row) throw new Error('trust: the address verification request was not written');

        await tx.insert(addressChecks).values({
          requestId: row.id,
          userId: input.userId,
          addressLine1: input.addressLine1,
          city: input.city,
          state: input.state,
          method: input.method,
          documentRef: input.documentRef ?? null,
          // Null: nobody has decided yet, and that is this column's normal state until a reviewer
          // sets it (T-052).
          passed: null,
        });

        if (input.documentRef && input.documentType) {
          await tx.insert(verificationDocuments).values({
            requestId: row.id,
            userId: input.userId,
            documentType: input.documentType,
            storageRef: input.documentRef,
          });
        }

        await publish(tx, verificationSubmitted, {
          payload: { requestId: row.id, userId: row.userId, type: 'ADDRESS' },
          aggregateType: 'verification_request',
          aggregateId: row.id,
        });
        return row;
      }),

    createSocialProofClaim: async (input) => {
      const [row] = await db
        .insert(socialProofClaims)
        .values({
          userId: input.userId,
          platform: input.platform,
          handle: input.handle,
          challengeCode: input.challengeCode,
        })
        .returning();
      if (!row) throw new Error('trust: the social proof claim was not written');
      return row;
    },

    findVerifiedHandleOwner: async ({ platform, handle }) => {
      const [row] = await db
        .select({ userId: socialProofClaims.userId })
        .from(socialProofClaims)
        .where(
          and(
            eq(socialProofClaims.platform, platform),
            eq(socialProofClaims.handle, handle),
            eq(socialProofClaims.verified, true),
          ),
        )
        .limit(1);
      return row?.userId;
    },

    hasVerifiedSocialClaim: async ({ userId, platform }) => {
      const [row] = await db
        .select({ id: socialProofClaims.id })
        .from(socialProofClaims)
        .where(
          and(
            eq(socialProofClaims.userId, userId),
            eq(socialProofClaims.platform, platform),
            eq(socialProofClaims.verified, true),
          ),
        )
        .limit(1);
      return row !== undefined;
    },

    findSocialProofClaim: async (claimId) => {
      const [row] = await db
        .select()
        .from(socialProofClaims)
        .where(eq(socialProofClaims.id, claimId))
        .limit(1);
      return row;
    },

    listSocialProofClaims: async (input) => {
      const where = eq(socialProofClaims.userId, input.userId);
      const [items, [totals]] = await Promise.all([
        db
          .select()
          .from(socialProofClaims)
          .where(where)
          .orderBy(desc(socialProofClaims.createdAt))
          .limit(input.limit)
          .offset((input.page - 1) * input.limit),
        db.select({ total: count() }).from(socialProofClaims).where(where),
      ]);
      return { items, total: totals?.total ?? 0 };
    },

    settleSocialProofClaim: async (input) => {
      /**
       * `last_checked_at` moves on EVERY call, pass or fail.
       *
       * It is what rate-limits a re-check, and a failed lookup that left it untouched would be a
       * free retry loop against a third party whose servers we have no contract with.
       *
       * The `verified = false` predicate is the idempotency: a redelivered job must not re-stamp
       * `verified_at` on a claim that is already proved, and the false return tells the caller it
       * had nothing to do.
       */
      const settled = await db
        .update(socialProofClaims)
        .set({
          lastCheckedAt: sql`now()`,
          ...(input.verified ? { verified: true, verifiedAt: sql`now()` } : {}),
        })
        .where(and(eq(socialProofClaims.id, input.claimId), eq(socialProofClaims.verified, false)))
        .returning({ id: socialProofClaims.id });
      return settled.length > 0;
    },

    listRecentRejections: async (userId): Promise<RejectedRequestRow[]> => {
      /**
       * The most recent REJECTED request per verification type, which is what VF1 and BVR1 render.
       *
       * `DISTINCT ON` rather than a window function or N queries: one index scan over
       * `verification_requests_user_idx`, and the shape the two screens need — one banner per check,
       * showing the latest answer. Bounded by the eight members of `verification_type`, so it is not
       * a collection needing a page.
       */
      const rows = await db
        .selectDistinctOn([verificationRequests.verificationType], {
          requestId: verificationRequests.id,
          verificationType: verificationRequests.verificationType,
          rejectionReason: verificationRequests.rejectionReason,
          decidedAt: verificationRequests.decidedAt,
        })
        .from(verificationRequests)
        .where(
          and(
            eq(verificationRequests.userId, userId),
            // EXPIRED as well as REJECTED. Both are terminal failures the user is looking at a
            // screen about, and a sweep that closed a request the provider never answered is the
            // `PROVIDER_UNAVAILABLE` case — leaving it out would make that code unrenderable.
            inArray(verificationRequests.status, ['REJECTED', 'EXPIRED']),
          ),
        )
        .orderBy(verificationRequests.verificationType, desc(verificationRequests.decidedAt));
      return rows;
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
          /**
           * `PROVIDER_UNAVAILABLE`, written here and nowhere else.
           *
           * Without it the code was unreachable and an expired request carried no reason at all, so
           * VF1 had nothing to render after the one failure that is not the user's fault. Its copy is
           * the only one on that screen that asks the user to do the same thing again rather than
           * change something, which is the difference between a retry and a support ticket.
           */
          .set({ status: 'EXPIRED', decidedAt: sql`now()`, rejectionReason: 'PROVIDER_UNAVAILABLE' })
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
