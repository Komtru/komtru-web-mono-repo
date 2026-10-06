// M20 §9's handlers. Thin, like notify's: the only judgement here is what NOT to return — never a
// storage_object_id, never a cloud_name on a retrieval, and never the difference between "no such
// file" and "not yours".
import type { Paginated } from '@komtru/shared-types';
import type { FilesConfig } from '../../../config/env.js';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { cursorPage, encodeCursor, type CursorKey } from '../../../platform/http/paginate.js';
import type { Logger } from '../../../platform/logger.js';
import type { QueueFactory } from '../../../platform/queue/factory.js';
import { PoolExhaustedError, StorageAccountUnconfiguredError } from '../domain/errors.js';
import { FILES_QUEUES, type DestroyAssetJob, type FinalizeUploadJob } from '../domain/queues.js';
import type { AccessSubject } from '../domain/access.js';
import {
  grantAccess,
  listAccessLog,
  listGrants,
  retrieveFile,
  revokeGrant,
  subjectFrom,
} from '../services/access.service.js';
import { listAccounts, registerAccount } from '../services/account.service.js';
import {
  createUploadTicket,
  requestFinalize,
  requestTombstone,
  type UploadTicketRequest,
} from '../services/file.service.js';
import type { FileCategory, FileVisibility, StoragePool } from '../infrastructure/postgres/schema/index.js';

/**
 * Resolved lazily: the platform reads a module's `routes` BEFORE `start` runs, so a handler cannot
 * close over the database or the queue factory — only reach for them when it is called.
 */
export interface FilesHttpDeps {
  db: () => Db;
  queues: () => QueueFactory;
  config: () => FilesConfig;
  logger: () => Logger;
}

/**
 * Turns the module's own failures into HTTP at the boundary.
 *
 * `StorageAccountUnconfiguredError` carries the three variable names an operator needs, and they stay
 * in the log: a consumer who just tried to upload a photo has no use for CLOUDINARY_TRADE_2_API_SECRET
 * and an attacker has some, so the response says only that storage is unavailable.
 */
export const translate = (logger: Logger, error: unknown): unknown => {
  if (error instanceof StorageAccountUnconfiguredError) {
    logger.error(
      { account: error.credentialEnvPrefix, missingVariables: error.missingVariables },
      'files: a storage account has no credentials in this environment',
    );
    return new ApiError(
      503,
      'FILE_STORAGE_UNAVAILABLE',
      'File storage is unavailable',
      'Try again shortly. If this persists, it is a configuration problem on our side.',
    );
  }

  if (error instanceof PoolExhaustedError) {
    logger.error({ pool: error.pool }, 'files: every storage account in a pool is unusable');
    return new ApiError(
      503,
      'FILE_STORAGE_UNAVAILABLE',
      'File storage is at capacity',
      'Uploads of this kind are paused. Provision another storage account to resume them.',
    );
  }

  return error;
};

/**
 * The same errors, for the operator-facing runbook endpoint.
 *
 * `POST /internal/storage-accounts` is gated on `role.grant` — a SUPER_ADMIN executing D6's "provision
 * a 6th account and rotation resumes, no deploy required". The privacy argument behind the generic
 * 503 above is about a consumer who tried to upload a photo; it does not apply to the one caller
 * whose whole purpose is to fix the configuration, and withholding the variable names from them
 * leaves exactly the dead end `registerAccount`'s refusal exists to prevent: a registration that
 * failed, uploads still failing, and nothing connecting the two.
 */
export const translateForOperator = (logger: Logger, error: unknown): unknown => {
  if (error instanceof StorageAccountUnconfiguredError) {
    return new ApiError(
      400,
      'VALIDATION_FAILED',
      'That storage account has no credentials here',
      `Set ${error.missingVariables.join(', ')} and restart, then register it again.`,
    );
  }

  return translate(logger, error);
};

const guard = async <T>(deps: FilesHttpDeps, run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    throw translate(deps.logger(), error);
  }
};

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export const createUploadUrl = async (
  deps: FilesHttpDeps,
  input: {
    uploaderUserId: string;
    scope: UploadTicketRequest['scope'];
    body: { category: string; visibility: string; contentType: string };
  },
) =>
  guard(deps, async () => {
    const ticket = await createUploadTicket(
      deps.db(),
      { files: deps.config() },
      {
        uploaderUserId: input.uploaderUserId,
        category: input.body.category as FileCategory,
        visibility: input.body.visibility as FileVisibility,
        contentType: input.body.contentType,
        scope: input.scope,
      },
    );

    return {
      fileId: ticket.fileId,
      cloudName: ticket.cloudName,
      uploadUrl: ticket.uploadUrl,
      // Contains `api_key` and `signature`. Never `api_secret` — that stays in this process.
      params: ticket.params,
      maxBytes: ticket.maxBytes,
      expiresAt: ticket.expiresAt.toISOString(),
    };
  });

/**
 * Answers 202 and hands the reconciliation to a job.
 *
 * The caller is told the server has heard them, not that the file is ready: only Cloudinary can say
 * the second, and no request handler may ask it (design §4.4). The job id is the file id, so a client
 * that retries does not create a second job.
 */
export const finalizeUpload = async (
  deps: FilesHttpDeps,
  input: { uploaderUserId: string; fileId: string },
) =>
  guard(deps, async () => {
    const record = await requestFinalize(deps.db(), {
      fileId: input.fileId,
      uploaderUserId: input.uploaderUserId,
    });

    if (record.uploadState !== 'READY') {
      const queue = deps.queues().producer<FinalizeUploadJob>(FILES_QUEUES.FINALIZE);

      /**
       * Clear any spent job FIRST, and catch ONLY this.
       *
       * The job id is the file id, which is what stops a double-submit queueing two
       * reconciliations — but BullMQ keeps a failed job for 30 days and `add` with an existing id
       * is a silent no-op. Without this remove, a finalize that exhausted its attempts could never
       * be retried: every later call would answer 202 and do nothing, until the abandoned sweep
       * tombstoned a file that had actually landed.
       *
       * `remove` refuses a job that is actively being worked, and that is the benign case — the
       * reconciliation the caller is asking for is already running — so it is logged and the
       * enqueue below is still attempted.
       */
      try {
        await queue.remove(record.id);
      } catch (error) {
        deps.logger().debug({ err: error, fileId: record.id }, 'files: finalize job is already in flight');
      }

      /**
       * NOT inside that try.
       *
       * `guardEnqueue` throws QueueUnavailableError when Redis is unreachable, precisely so an
       * enqueue during an outage fails rather than hanging. Swallowing it would answer 202 for work
       * that will never run — the same false acceptance this code path exists to prevent, arriving
       * through the error handler instead of through BullMQ's deduplication.
       */
      await queue.add('finalize', { fileId: record.id }, { jobId: record.id });
    }

    return { fileId: record.id, uploadState: record.uploadState };
  });

export const retrieve = async (deps: FilesHttpDeps, input: { fileId: string; subject: AccessSubject }) =>
  guard(deps, async () => {
    const result = await retrieveFile(deps.db(), { files: deps.config(), logger: deps.logger() }, input);

    return {
      fileId: result.fileId,
      url: result.url,
      // Null for PUBLIC — stated rather than omitted, so a client can tell "does not expire" from
      // "expiry unknown" and cache accordingly.
      expiresAt: result.expiresAt?.toISOString() ?? null,
      contentType: result.contentType,
      sizeBytes: result.sizeBytes,
      category: result.category,
    };
  });

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const tombstone = async (
  deps: FilesHttpDeps,
  input: { fileId: string; reason: string; actorUserId: string },
) =>
  guard(deps, async () => {
    const record = await requestTombstone(deps.db(), {
      fileId: input.fileId,
      reason: input.reason,
      actorUserId: input.actorUserId,
    });

    // The row is already tombstoned and the event already published; destroying the bytes is the
    // job's work. An enqueue failure leaves an asset for the operator, never a half-applied delete.
    try {
      await deps
        .queues()
        .producer<DestroyAssetJob>(FILES_QUEUES.DESTROY)
        .add('destroy', { fileId: record.id }, { jobId: record.id });
    } catch (error) {
      deps
        .logger()
        .error(
          { err: error, fileId: record.id },
          'files: could not enqueue the destroy job; asset is orphaned',
        );
    }

    return {
      fileId: record.id,
      status: record.status,
      reason: record.tombstonedReason,
      tombstonedAt: record.tombstonedAt?.toISOString() ?? null,
    };
  });

export const grant = async (
  deps: FilesHttpDeps,
  input: { fileId: string; granteeUserId?: string; granteeRole?: string; reason: string },
) =>
  guard(deps, async () => {
    const created = await grantAccess(deps.db(), {
      fileId: input.fileId,
      granteeUserId: input.granteeUserId ?? null,
      granteeRole: input.granteeRole ?? null,
      reason: input.reason,
    });

    return {
      id: created.id,
      fileId: created.fileId,
      granteeUserId: created.granteeUserId,
      granteeRole: created.granteeRole,
      reason: created.grantedReason,
      grantedAt: created.grantedAt.toISOString(),
    };
  });

export interface GrantView {
  id: string;
  fileId: string;
  granteeUserId: string | null;
  granteeRole: string | null;
  reason: string;
  grantedAt: string;
}

export const grants = async (
  deps: FilesHttpDeps,
  input: { fileId: string; limit: number; cursor?: CursorKey },
): Promise<Paginated<GrantView>> =>
  guard(deps, async () => {
    const rows = await listGrants(deps.db(), input.fileId);
    const after = typeof input.cursor?.id === 'string' ? input.cursor.id : undefined;
    const start = after ? rows.findIndex((row) => row.id === after) + 1 : 0;
    const page = rows.slice(start, start + input.limit + 1);

    return cursorPage(
      page.map((row) => ({
        id: row.id,
        fileId: row.fileId,
        granteeUserId: row.granteeUserId,
        granteeRole: row.granteeRole,
        reason: row.grantedReason,
        grantedAt: row.grantedAt.toISOString(),
      })),
      input.limit,
      (row) => ({ id: row.id }),
    );
  });

export const revoke = async (deps: FilesHttpDeps, input: { fileId: string; grantId: string }) =>
  guard(deps, async () => {
    const revoked = await revokeGrant(deps.db(), input.fileId, input.grantId);
    // 404 whether the grant belongs to another file or never existed: the same reasoning that keeps
    // retrieval from being an id oracle.
    if (!revoked) throw new ApiError(404, 'NOT_FOUND', 'No such active grant');
    return { revoked: true as const };
  });

export interface AccessLogView {
  occurredAt: string;
  accessedByUserId: string | null;
  accessedByAdminId: string | null;
  accessGranted: boolean;
  deniedReason: string | null;
}

export const accessLog = async (
  deps: FilesHttpDeps,
  input: { fileId: string; limit: number; cursor?: CursorKey },
): Promise<Paginated<AccessLogView>> =>
  guard(deps, async () => {
    const before =
      typeof input.cursor?.occurredAt === 'string' ? new Date(input.cursor.occurredAt) : undefined;
    const rows = await listAccessLog(deps.db(), input.fileId, {
      limit: input.limit + 1,
      ...(before ? { before } : {}),
    });

    const items = rows.slice(0, input.limit).map((row) => ({
      occurredAt: row.occurredAt.toISOString(),
      accessedByUserId: row.accessedByUserId,
      accessedByAdminId: row.accessedByAdminId,
      accessGranted: row.accessGranted,
      deniedReason: row.deniedReason,
    }));

    const last = items.at(-1);
    return {
      items,
      nextCursor: rows.length > input.limit && last ? encodeCursor({ occurredAt: last.occurredAt }) : null,
    };
  });

// ---------------------------------------------------------------------------
// Internal / ops — backs the platform-health surface
// ---------------------------------------------------------------------------

export interface StorageAccountView {
  id: string;
  pool: StoragePool;
  label: string;
  cloudName: string;
  credentialEnvPrefix: string;
  status: string;
  rotationOrder: number | null;
  storageUsedBytes: number;
  creditsUsedPct: number;
  lastUsageSyncedAt: string | null;
}

export const storageAccounts = async (
  deps: FilesHttpDeps,
  input: { limit: number; cursor?: CursorKey },
): Promise<Paginated<StorageAccountView>> =>
  guard(deps, async () => {
    const rows = await listAccounts(deps.db());
    const after = typeof input.cursor?.id === 'string' ? input.cursor.id : undefined;
    const start = after ? rows.findIndex((row) => row.id === after) + 1 : 0;

    return cursorPage(
      rows.slice(start, start + input.limit + 1).map((row) => ({
        id: row.id,
        pool: row.pool,
        label: row.label,
        // `cloud_name` is safe to show an operator and is what they match in the Cloudinary console.
        // The api_key and api_secret are never read here at all.
        cloudName: row.cloudName,
        credentialEnvPrefix: row.credentialEnvPrefix,
        status: row.status,
        rotationOrder: row.rotationOrder,
        storageUsedBytes: row.storageUsedBytes,
        creditsUsedPct: Number(row.creditsUsedPct),
        lastUsageSyncedAt: row.lastUsageSyncedAt?.toISOString() ?? null,
      })),
      input.limit,
      (row) => ({ id: row.id }),
    );
  });

export const registerStorageAccount = async (
  deps: FilesHttpDeps,
  input: {
    pool: string;
    label: string;
    cloudName: string;
    credentialEnvPrefix: string;
    rotationOrder?: number;
  },
) => {
  try {
    const created = await registerAccount(deps.db(), deps.config(), {
      pool: input.pool as StoragePool,
      label: input.label,
      cloudName: input.cloudName,
      credentialEnvPrefix: input.credentialEnvPrefix,
      rotationOrder: input.rotationOrder ?? null,
    });

    return {
      id: created.id,
      pool: created.pool,
      label: created.label,
      rotationOrder: created.rotationOrder,
    };
  } catch (error) {
    throw translateForOperator(deps.logger(), error);
  }
};

export { subjectFrom };
