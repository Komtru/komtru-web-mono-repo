// Adapted from kumtru/backend-apis/src/modules/files/services/access.service.ts (T-001, same shape):
// the database handle and configuration are arguments, grants are published through the outbox, and
// `subjectFrom` takes the platform's resolved Principal.
//
// Retrieval, and the access control on it (M20 §6, D2, D3).
//
// This is the file the module exists to get right. The decision itself is a pure function in
// domain/access.ts; what lives here is everything around it — loading the grants it needs, logging
// the outcome for the sensitive categories, and turning an allow into a signed URL.
//
// Signing is a call into cloudinary.signing.ts, which is pure arithmetic. Nothing here reaches the
// network, which is why retrieval can answer inside the request rather than through a job.
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import type { FilesConfig } from '../../../config/env.js';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import type { Logger } from '../../../platform/logger.js';
import type { Principal } from '../../../platform/http/principal.js';
import { publish } from '../../../platform/events/publish.js';
import { DENIAL_MESSAGE, decideAccess, type AccessDecision, type AccessSubject } from '../domain/access.js';
import { fileAccessGranted } from '../domain/events.js';
import { isAuditedCategory, resourceTypeFor } from '../domain/pools.js';
import { credentialsFor } from '../infrastructure/credentials.js';
import {
  buildExpiringDownloadUrl,
  buildSignedDeliveryUrl,
} from '../infrastructure/providers/cloudinary.signing.js';
import type { Reader } from '../infrastructure/postgres/reader.js';
import {
  fileAccessGrants,
  fileAccessLog,
  type FileAccessGrant,
  type FileAccessLogRow,
  type FileRecord,
} from '../infrastructure/postgres/schema/index.js';
import { findAccountById } from './account.service.js';
import { findFile } from './file.service.js';

export interface AccessServiceDeps {
  files: FilesConfig;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// Grants (M20 §3.5)
// ---------------------------------------------------------------------------

export interface GrantInput {
  fileId: string;
  granteeUserId?: string | null;
  granteeRole?: string | null;
  reason: string;
}

/**
 * Grants access to a `PRIVATE_CASE` file.
 *
 * Idempotent on the live-grant partial unique indexes: re-granting the same subject returns the
 * existing row rather than erroring. M3's `dispute.opened` handler is at-least-once by contract
 * (M20 §8), so it WILL run twice, and a duplicate-key 500 on the second delivery would leave a
 * dispute half-wired.
 */
export const grantAccess = async (db: Db, input: GrantInput): Promise<FileAccessGrant> => {
  if (Boolean(input.granteeUserId) === Boolean(input.granteeRole)) {
    throw new ApiError(
      400,
      'VALIDATION_FAILED',
      'A grant names exactly one subject',
      'Pass exactly one of granteeUserId or granteeRole; granting both is ambiguous about which a later revoke removes.',
    );
  }

  const record = await findFile(db, input.fileId);
  if (!record) throw notFound();

  // A grant on any other class would be inert — decideAccess only consults grants for PRIVATE_CASE —
  // so accepting one would let an operator believe they had shared a file when they had not.
  if (record.visibility !== 'PRIVATE_CASE') {
    throw new ApiError(
      409,
      'CONFLICT',
      'Access grants only apply to case files',
      `Grants are consulted only for PRIVATE_CASE files; this one is ${record.visibility}.`,
    );
  }

  const existing = await findActiveGrant(db, input);
  if (existing) return existing;

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(fileAccessGrants)
      .values({
        fileId: input.fileId,
        granteeUserId: input.granteeUserId ?? null,
        granteeRole: input.granteeRole ?? null,
        grantedReason: input.reason,
      })
      .returning();

    if (!created) throw new Error('files: grant insert returned no row');

    await publish(tx, fileAccessGranted, {
      payload: {
        fileId: input.fileId,
        granteeUserId: input.granteeUserId ?? null,
        granteeRole: input.granteeRole ?? null,
        reason: input.reason,
      },
      aggregateType: 'file',
      aggregateId: input.fileId,
    });

    return created;
  });
};

const findActiveGrant = async (db: Reader, input: GrantInput): Promise<FileAccessGrant | undefined> => {
  const subject = input.granteeUserId
    ? eq(fileAccessGrants.granteeUserId, input.granteeUserId)
    : eq(fileAccessGrants.granteeRole, input.granteeRole ?? '');

  const [found] = await db
    .select()
    .from(fileAccessGrants)
    .where(and(eq(fileAccessGrants.fileId, input.fileId), subject, isNull(fileAccessGrants.revokedAt)))
    .limit(1);

  return found;
};

/** Returns whether a live grant was revoked, so a caller can answer 404 for one that was not. */
export const revokeGrant = async (db: Db, fileId: string, grantId: string): Promise<boolean> => {
  const revoked = await db
    .update(fileAccessGrants)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(fileAccessGrants.id, grantId),
        // Scoped to the file in the path, so a grant id cannot be revoked through another file's URL.
        eq(fileAccessGrants.fileId, fileId),
        isNull(fileAccessGrants.revokedAt),
      ),
    )
    .returning({ id: fileAccessGrants.id });

  return revoked.length > 0;
};

export const listGrants = async (db: Reader, fileId: string): Promise<FileAccessGrant[]> =>
  db
    .select()
    .from(fileAccessGrants)
    .where(and(eq(fileAccessGrants.fileId, fileId), isNull(fileAccessGrants.revokedAt)))
    .orderBy(desc(fileAccessGrants.grantedAt));

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

export interface RetrievalResult {
  fileId: string;
  url: string;
  /** Null for a PUBLIC file — see the note on the delivery URL below. */
  expiresAt: Date | null;
  contentType: string;
  sizeBytes: number;
  category: FileRecord['category'];
}

/**
 * A missing file and a refused file give the SAME 404.
 *
 * Distinguishing them turns this endpoint into an existence oracle over every file id in the system,
 * which for DISPUTE_EVIDENCE leaks that a dispute exists at all.
 */
const notFound = (): ApiError => new ApiError(404, 'NOT_FOUND', 'File not found');

/**
 * Resolves a file to a signed URL, or refuses.
 *
 * Every outcome for an audited category is written to `file_access_log` — refusals included, and
 * especially. A pattern of refused reads against KYC documents is the thing an investigation is
 * looking for, and a log that only records successes cannot show it.
 */
export const retrieveFile = async (
  db: Db,
  deps: AccessServiceDeps,
  input: { fileId: string; subject: AccessSubject },
): Promise<RetrievalResult> => {
  const record = await findFile(db, input.fileId);

  if (!record) throw notFound();

  const decision = await decide(db, record, input.subject);

  await recordAccess(db, deps.logger, record, input.subject, decision);

  if (!decision.allowed) {
    // TOMBSTONED is the one case allowed to be specific: it says nothing an authorised caller did not
    // already know, and everything a confused one needs (D4 keeps the reference resolvable).
    if (decision.reason === 'TOMBSTONED') {
      throw new ApiError(410, 'FILE_TOMBSTONED', DENIAL_MESSAGE.TOMBSTONED);
    }
    throw notFound();
  }

  /**
   * Completeness is checked AFTER the access decision, deliberately.
   *
   * Checking first would answer "does this file id exist and is it finished" to an unauthorised
   * caller, which is the oracle again by another route.
   */
  if (record.uploadState !== 'READY') {
    throw new ApiError(409, 'CONFLICT', 'This upload has not completed yet');
  }

  return signFor(db, deps.files, record);
};

const decide = async (db: Reader, record: FileRecord, subject: AccessSubject): Promise<AccessDecision> => {
  // Grants are only loaded for the one class that consults them — a PUBLIC listing image should not
  // pay for a grants query on every view.
  const grants = record.visibility === 'PRIVATE_CASE' ? await listGrants(db, record.id) : [];

  return decideAccess(subject, {
    visibility: record.visibility,
    status: record.status,
    uploaderUserId: record.uploaderUserId,
    grantedUserIds: grants.map((grant) => grant.granteeUserId).filter((id): id is string => id !== null),
    grantedRoles: grants.map((grant) => grant.granteeRole).filter((role): role is string => role !== null),
  });
};

/**
 * Issues the URL, choosing the mechanism by visibility.
 *
 * PUBLIC gets a signed but non-expiring delivery URL, which is what a browser needs for an `<img src>`
 * and is honest about what "public" means. Everything restricted gets a genuinely expiring download
 * URL, because there the URL IS the capability — anyone holding it fetches the bytes with no token —
 * so its lifetime is the window in which a leaked link is useful.
 */
const signFor = async (db: Reader, files: FilesConfig, record: FileRecord): Promise<RetrievalResult> => {
  const account = await findAccountById(db, record.storageAccountId);
  if (!account) throw new Error('files: file references an unknown storage account');

  const credentials = credentialsFor(files, account.credentialEnvPrefix);
  const resourceType = resourceTypeFor(record.contentType);

  const base = {
    fileId: record.id,
    contentType: record.contentType,
    sizeBytes: record.sizeBytes,
    category: record.category,
  };

  if (record.visibility === 'PUBLIC') {
    return {
      ...base,
      url: buildSignedDeliveryUrl({ credentials, publicId: record.storageObjectId, resourceType }),
      expiresAt: null,
    };
  }

  const signed = buildExpiringDownloadUrl({
    credentials,
    publicId: record.storageObjectId,
    resourceType,
    ttlSeconds: files.signedUrlTtlSeconds,
  });

  return { ...base, url: signed.url, expiresAt: signed.expiresAt };
};

// ---------------------------------------------------------------------------
// Access logging (M20 §3.6, §6)
// ---------------------------------------------------------------------------

/**
 * Never throws.
 *
 * A failed audit write must not fail the read it was auditing — but it must not pass silently either,
 * so it logs at ERROR. That is the trade-off M15 makes too: a compliance log with a gap is a problem
 * an operator can investigate, an outage on every KYC document view is a problem for every user at
 * once.
 */
const recordAccess = async (
  db: Db,
  logger: Logger,
  record: FileRecord,
  subject: AccessSubject,
  decision: AccessDecision,
): Promise<void> => {
  if (!isAuditedCategory(record.category)) return;

  try {
    await db.insert(fileAccessLog).values({
      fileId: record.id,
      // One column or the other, never both: "which staff member" and "which user" are different
      // questions to a compliance reader.
      accessedByUserId: subject.scope === 'STAFF' ? null : subject.userId,
      accessedByAdminId: subject.scope === 'STAFF' ? subject.userId : null,
      accessGranted: decision.allowed,
      deniedReason: decision.allowed ? null : decision.reason,
    });
  } catch (error) {
    logger.error({ err: error, fileId: record.id }, 'files: failed to write the access log entry');
  }
};

export interface AccessLogPage {
  limit: number;
  /** Keyset cursor: the `occurred_at` of the last row returned. */
  before?: Date;
}

export const listAccessLog = async (
  db: Reader,
  fileId: string,
  page: AccessLogPage,
): Promise<FileAccessLogRow[]> =>
  db
    .select()
    .from(fileAccessLog)
    .where(
      and(
        eq(fileAccessLog.fileId, fileId),
        ...(page.before ? [lt(fileAccessLog.occurredAt, page.before)] : []),
      ),
    )
    .orderBy(desc(fileAccessLog.occurredAt))
    .limit(page.limit);

/**
 * Builds the subject from a resolved principal, so callers never assemble one by hand.
 *
 * Takes the whole `Principal`, which T-031 re-reads from the database on every request — never
 * `actor.key`, whose `user:` prefix is a storage detail of the idempotency and rate-limit tables and
 * not an authentication check.
 */
export const subjectFrom = (principal: Principal): AccessSubject => ({
  userId: principal.userId,
  scope: principal.scope,
  roles: principal.roles,
});
