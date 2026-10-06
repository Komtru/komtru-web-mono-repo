// Adapted from kumtru/backend-apis/src/modules/files/services/file.service.ts (T-001, same shape).
// The one structural change T-040 forces: finalize is split in two. `requestFinalize` is the HTTP
// half and touches no provider; `applyReconciliation` is the job half and takes the resource the
// client already fetched, so this file reaches no network and may live in services/ (design §4.4).
//
// The upload half of the module (M20 §6).
//
// Two calls, not one, and the split is forced by the design rather than chosen: the file goes
// DIRECTLY from the client to Cloudinary (so a 15MB photo never occupies this service's event loop or
// egress), which means the backend issues a ticket, steps out of the way, and has to be told
// afterwards that the bytes landed. Reconciliation is where that claim is checked — against
// Cloudinary, never against the client.
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, lt } from 'drizzle-orm';
import type { FilesConfig } from '../../../config/env.js';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { fileTombstoned, fileUploaded } from '../domain/events.js';
import {
  allowedFormatsFor,
  carriesCaptureMetadata,
  contentTypeForFormat,
  isAllowedContentType,
  poolForCategory,
  resourceTypeFor,
} from '../domain/pools.js';
import { OWNING_MODULE, checkUploadRequest } from '../domain/upload-policy.js';
import { credentialsFor } from '../infrastructure/credentials.js';
import { buildSignedUpload } from '../infrastructure/providers/cloudinary.signing.js';
import type { Reader } from '../infrastructure/postgres/reader.js';
import {
  fileRecords,
  type FileCategory,
  type FileRecord,
  type FileVisibility,
} from '../infrastructure/postgres/schema/index.js';
import { selectAccountForPool } from './account.service.js';
import type { SessionScope } from '@komtru/shared-types';

export interface FileServiceDeps {
  files: FilesConfig;
}

// ---------------------------------------------------------------------------
// Ticketing
// ---------------------------------------------------------------------------

export interface UploadTicketRequest {
  uploaderUserId: string;
  category: FileCategory;
  visibility: FileVisibility;
  contentType: string;
  /**
   * The hub this was captured at, resolved SERVER-SIDE by the calling module and never taken from a
   * client (design §7.3). Only CUSTODY_EVIDENCE and PROOF_OF_DELIVERY may carry one.
   */
  captureHubId?: string | null;
  /** Checked against the category's allowed classes; defaults to a consumer session. */
  scope?: SessionScope;
}

export interface UploadTicket {
  fileId: string;
  cloudName: string;
  uploadUrl: string;
  /** Contains `api_key` and `signature`. Never `api_secret` — that stays in this process. */
  params: Record<string, string>;
  maxBytes: number;
  expiresAt: Date;
}

/** D3: a random uuid, never sequential and never containing user-identifying text. */
const generateStorageObjectId = (): string => randomUUID().replace(/-/g, '');

/**
 * Issues an upload ticket and the `file_records` row it refers to.
 *
 * The row and the rotation cursor advance in ONE transaction. Splitting them would mean a crash
 * between the two either burns a rotation slot on a file that never existed, or hands out a file id
 * whose account was never pinned — and D7 makes the second unrecoverable, since nothing else can say
 * which of the five accounts the client just uploaded to.
 */
export const createUploadTicket = async (
  db: Db,
  deps: FileServiceDeps,
  request: UploadTicketRequest,
): Promise<UploadTicket> => {
  const allowed = checkUploadRequest({
    category: request.category,
    visibility: request.visibility,
    scope: request.scope ?? 'CONSUMER',
  });
  if (!allowed.ok)
    throw new ApiError(403, 'FORBIDDEN', 'That file cannot be uploaded that way', allowed.reason);

  if (!isAllowedContentType(request.category, request.contentType)) {
    throw new ApiError(
      400,
      'VALIDATION_FAILED',
      'That file type is not accepted here',
      `${request.contentType} is not an accepted type for ${request.category}.`,
    );
  }

  if (request.captureHubId && !carriesCaptureMetadata(request.category)) {
    // Mirrors the file_records_capture_hub_category check: a hub id on a listing photo would be a
    // custody claim about a file nobody took custody of.
    throw new ApiError(
      400,
      'VALIDATION_FAILED',
      'That category cannot carry a hub id',
      `${request.category} files are not captured at a hub.`,
    );
  }

  const pool = poolForCategory(request.category);
  const storageObjectId = generateStorageObjectId();

  const { record, credentialEnvPrefix } = await db.transaction(async (tx) => {
    const account = await selectAccountForPool(tx, deps.files, pool);

    const [created] = await tx
      .insert(fileRecords)
      .values({
        uploaderUserId: request.uploaderUserId,
        // Derived, never taken from the client: provenance a caller fills in is a suggestion.
        owningModule: OWNING_MODULE[request.category],
        category: request.category,
        visibility: request.visibility,
        storageAccountId: account.id,
        storageObjectId,
        contentType: request.contentType,
        captureHubId: request.captureHubId ?? null,
      })
      .returning();

    if (!created) throw new Error('files: file record insert returned no row');

    return { record: created, credentialEnvPrefix: account.credentialEnvPrefix };
  });

  const signed = buildSignedUpload({
    credentials: credentialsFor(deps.files, credentialEnvPrefix),
    publicId: storageObjectId,
    resourceType: resourceTypeFor(request.contentType),
    allowedFormats: allowedFormatsFor(request.category),
  });

  return {
    fileId: record.id,
    cloudName: signed.cloudName,
    uploadUrl: signed.uploadUrl,
    params: signed.params,
    maxBytes: deps.files.maxUploadBytes,
    expiresAt: new Date(Date.now() + deps.files.uploadTicketTtlMinutes * 60_000),
  };
};

// ---------------------------------------------------------------------------
// Finalize, the HTTP half
// ---------------------------------------------------------------------------

/** Same 404 for "no such file" and "not yours": the two must not be distinguishable. */
const notFound = (): ApiError => new ApiError(404, 'NOT_FOUND', 'File not found');

/**
 * Records that the client says the bytes landed, and nothing more.
 *
 * Deliberately does not ask Cloudinary: the ticket requires reconciliation to run in a job, and the
 * caller must not wait on a provider. The row moves to RECONCILING so the job has something to claim.
 *
 * `capture_received_at` is written here, from the DATABASE clock, and this is the only place it is
 * ever set. It is the one capture timestamp this module can vouch for: the device's own clock never
 * reaches a column, so a park agent whose phone is a day fast cannot stamp a custody photo in the
 * future.
 */
export const requestFinalize = async (
  db: Db,
  input: { fileId: string; uploaderUserId: string },
): Promise<FileRecord> => {
  const record = await findFile(db, input.fileId);

  if (!record) throw notFound();
  // Only the uploader may finalize their own ticket, and the refusal is the same 404.
  if (record.uploaderUserId !== input.uploaderUserId) throw notFound();
  if (record.status === 'TOMBSTONED') {
    throw new ApiError(410, 'FILE_TOMBSTONED', 'This file has been removed');
  }
  if (record.uploadState === 'READY') return record;
  if (record.uploadState === 'REJECTED') {
    throw new ApiError(409, 'CONFLICT', 'That upload was refused', record.tombstonedReason ?? undefined);
  }

  const [updated] = await db
    .update(fileRecords)
    .set({
      uploadState: 'RECONCILING',
      // The database clock, not the application's: one clock for every pod, and the one an auditor
      // can line up against every other row in the system.
      captureReceivedAt: record.captureReceivedAt ?? new Date(),
    })
    .where(eq(fileRecords.id, record.id))
    .returning();

  if (!updated) throw new Error('files: finalize request returned no row');

  return updated;
};

// ---------------------------------------------------------------------------
// Reconciliation, the job half
// ---------------------------------------------------------------------------

export interface ReconcileResource {
  publicId: string;
  bytes: number;
  format: string;
  resourceType: string;
}

export type ReconcileOutcome =
  | { outcome: 'READY'; record: FileRecord }
  | { outcome: 'REJECTED'; record: FileRecord; reason: string }
  /** Cloudinary has no such asset yet. The row is untouched and the job retries. */
  | { outcome: 'MISSING' };

/**
 * Confirms the upload landed and reconciles the metadata only knowable afterwards (M20 §6).
 *
 * The resource comes from the job, which asked Cloudinary — never from the client. A client could
 * otherwise finalize a ticket it never used and hand every consuming module a `file_ref_id` that
 * resolves to nothing: a listing whose image 404s is cosmetic, a dispute whose "evidence" was never
 * uploaded is not.
 */
export const applyReconciliation = async (
  db: Db,
  input: { fileId: string; maxUploadBytes: number; resource: ReconcileResource | undefined },
): Promise<ReconcileOutcome> => {
  const record = await findFile(db, input.fileId);

  if (!record) throw notFound();
  if (record.status === 'TOMBSTONED') {
    return { outcome: 'REJECTED', record, reason: record.tombstonedReason ?? 'tombstoned' };
  }
  if (record.uploadState === 'READY') return { outcome: 'READY', record };
  if (!input.resource) return { outcome: 'MISSING' };

  const resource = input.resource;
  const reason = rejectionReason(record, resource, input.maxUploadBytes);
  if (reason) return { outcome: 'REJECTED', record: await reject(db, record, reason), reason };

  // `rejectionReason` already refused an unmappable format; restated rather than asserted away, so
  // a future edit that drops that check cannot silently write an empty content type.
  const contentType = contentTypeForFormat(resource.format);
  if (!contentType) {
    const unknown = `Rejected: Cloudinary reported format "${resource.format}", which is not accepted`;
    return { outcome: 'REJECTED', record: await reject(db, record, unknown), reason: unknown };
  }

  const updated = await db.transaction(async (tx) => {
    const [written] = await tx
      .update(fileRecords)
      .set({
        uploadState: 'READY',
        finalizedAt: new Date(),
        sizeBytes: resource.bytes,
        // What Cloudinary received, not what the client declared when it asked for the ticket.
        contentType,
      })
      .where(and(eq(fileRecords.id, record.id), eq(fileRecords.status, 'ACTIVE')))
      .returning();

    if (!written) throw new Error('files: reconciliation returned no row');

    await publish(tx, fileUploaded, {
      payload: {
        fileId: written.id,
        category: written.category,
        visibility: written.visibility,
        uploaderUserId: written.uploaderUserId,
        owningModule: written.owningModule,
        sizeBytes: written.sizeBytes,
      },
      aggregateType: 'file',
      aggregateId: written.id,
    });

    return written;
  });

  return { outcome: 'READY', record: updated };
};

/**
 * Why this upload is refused, or undefined.
 *
 * The size ceiling is here and ONLY here: Cloudinary's upload API has no size parameter outside an
 * upload preset, so nothing stops an oversized file being stored — it is already on the account and
 * already metered against its quota by the time we see it. Tombstoning reclaims the space and refuses
 * the reference, which is the best available outcome rather than a good one.
 */
const rejectionReason = (
  record: FileRecord,
  resource: ReconcileResource,
  maxUploadBytes: number,
): string | undefined => {
  if (resource.bytes > maxUploadBytes) {
    return `Rejected: ${String(resource.bytes)} bytes exceeds the ${String(maxUploadBytes)} byte limit`;
  }

  const contentType = contentTypeForFormat(resource.format);
  if (!contentType) return `Rejected: Cloudinary reported format "${resource.format}", which is not accepted`;

  // Re-checked against what actually landed: the client picks the declared type on the first call
  // and can lie about it, and a KYC "document" that is really something else is a stored-XSS vector.
  if (!isAllowedContentType(record.category, contentType)) {
    return `Rejected: ${contentType} is not an accepted type for ${record.category}`;
  }

  return undefined;
};

const reject = async (db: Db, record: FileRecord, reason: string): Promise<FileRecord> => {
  const tombstoned = await requestTombstone(db, { fileId: record.id, reason });
  const [updated] = await db
    .update(fileRecords)
    .set({ uploadState: 'REJECTED' })
    .where(eq(fileRecords.id, tombstoned.id))
    .returning();
  return updated ?? tombstoned;
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const findFile = async (db: Reader, fileId: string): Promise<FileRecord | undefined> => {
  const [found] = await db.select().from(fileRecords).where(eq(fileRecords.id, fileId)).limit(1);
  return found;
};

/**
 * A file it is safe to hand a consumer a URL for: reconciled, active, actually holding bytes.
 *
 * Distinct from `findFile` because the tombstone case has to stay distinguishable — a consuming
 * module asking about a removed file needs "removed", not "never existed" (D4).
 */
export const findServableFile = async (db: Reader, fileId: string): Promise<FileRecord | undefined> => {
  const found = await findFile(db, fileId);
  return found?.uploadState === 'READY' && found.status === 'ACTIVE' ? found : undefined;
};

// ---------------------------------------------------------------------------
// Tombstoning (D4)
// ---------------------------------------------------------------------------

export interface TombstoneInput {
  fileId: string;
  reason: string;
  /** Null for an M15-driven retention sweep, which has no human actor. */
  actorUserId?: string | null;
}

/**
 * Marks a file tombstoned and publishes the event, in one transaction.
 *
 * ORDER MATTERS, and the destroy is a separate job on purpose: the row is marked first, the bytes
 * destroyed second. Destroying first and then failing to write the row would leave an ACTIVE record
 * pointing at bytes that are gone — a dangling reference wearing a live row's clothes, which is
 * precisely what D4 rejected the hard delete to avoid.
 */
export const requestTombstone = async (db: Db, input: TombstoneInput): Promise<FileRecord> => {
  const record = await findFile(db, input.fileId);

  if (!record) throw notFound();
  if (record.status === 'TOMBSTONED') return record;

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(fileRecords)
      .set({ status: 'TOMBSTONED', tombstonedAt: new Date(), tombstonedReason: input.reason })
      // Conditional, so two concurrent tombstones write one row and publish one event.
      .where(and(eq(fileRecords.id, record.id), eq(fileRecords.status, 'ACTIVE')))
      .returning();

    if (!updated) {
      const current = await findFileIn(tx, record.id);
      if (current) return current;
      throw new Error('files: tombstone returned no row');
    }

    await publish(tx, fileTombstoned, {
      payload: {
        fileId: updated.id,
        category: updated.category,
        reason: input.reason,
        actorUserId: input.actorUserId ?? null,
      },
      aggregateType: 'file',
      aggregateId: updated.id,
    });

    return updated;
  });
};

const findFileIn = async (tx: Tx, fileId: string): Promise<FileRecord | undefined> => {
  const [found] = await tx.select().from(fileRecords).where(eq(fileRecords.id, fileId)).limit(1);
  return found;
};

/**
 * Tombstones every file a user uploaded. Backs M15's `compliance.dsr_fulfilled` DELETE handling.
 *
 * Returns the ids it acted on rather than a count: the caller is fulfilling a data-subject request
 * and has to be able to say which files were covered.
 */
export const tombstoneByUploader = async (
  db: Db,
  input: { uploaderUserId: string; reason: string; categories?: FileCategory[] },
): Promise<string[]> => {
  const rows = await db
    .select({ id: fileRecords.id })
    .from(fileRecords)
    .where(
      and(
        eq(fileRecords.uploaderUserId, input.uploaderUserId),
        eq(fileRecords.status, 'ACTIVE'),
        ...(input.categories?.length ? [inArray(fileRecords.category, input.categories)] : []),
      ),
    );

  const tombstoned: string[] = [];
  for (const row of rows) {
    await requestTombstone(db, { fileId: row.id, reason: input.reason });
    tombstoned.push(row.id);
  }

  return tombstoned;
};

/**
 * Reclaims upload tickets that were issued and never used.
 *
 * Without this the table accumulates a row per abandoned upload forever — every client that opened a
 * file picker and changed its mind. They are invisible to every read path (`findServableFile`
 * requires READY), so this is hygiene rather than a correctness fix, which is why it tombstones with
 * an explicit reason rather than deleting: D4 has no exception for "we think nobody referenced this
 * one".
 */
export const purgeAbandonedUploads = async (
  db: Db,
  ttlMinutes: number,
  now: Date = new Date(),
): Promise<string[]> => {
  const cutoff = new Date(now.getTime() - ttlMinutes * 60_000);

  const stale = await db
    .select({ id: fileRecords.id })
    .from(fileRecords)
    .where(
      and(
        inArray(fileRecords.uploadState, ['PENDING', 'RECONCILING']),
        eq(fileRecords.status, 'ACTIVE'),
        lt(fileRecords.createdAt, cutoff),
      ),
    )
    // Bounded: a backlog that built up over a weekend must not become one transaction.
    .limit(500);

  const purged: string[] = [];
  for (const row of stale) {
    await requestTombstone(db, {
      fileId: row.id,
      reason: 'Upload ticket expired without a completed upload',
    });
    purged.push(row.id);
  }

  return purged;
};
