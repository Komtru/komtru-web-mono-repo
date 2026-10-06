// M20 §9's surface, declared with defineRoute — the only way a route is registered, so mountRoutes
// checks every one of these at boot for a scope, a permission where one belongs, pagination on every
// collection and an explicit retryable decision.
//
// The admin and internal routes reuse identity's existing M1 §12.2 permissions rather than
// introducing `file.*` ones: a new permission needs a row in the twelve-role matrix, and a permission
// with no distinct audience is one nobody remembers to grant. The mapping is stated per route,
// because "why this permission" is the question a reviewer actually has.
import { paginatedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { ApiError } from '../../../platform/errors.js';
import { requireUserId } from '../../../platform/http/principal.js';
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import * as controllers from './controllers.js';
import type { FilesHttpDeps } from './controllers.js';
import {
  createUploadUrlBody,
  fileCategorySchema,
  fileIdParams,
  grantAccessBody,
  grantIdParams,
  registerStorageAccountBody,
  storagePoolSchema,
  tombstoneBody,
} from './validations.js';

const UPLOAD_A_FILE = 'Sign in to upload a file';
const SEE_A_FILE = 'Sign in to see this file';

const DEFAULT_PAGE = 20;

const uploadTicketSchema = z.object({
  fileId: z.uuid(),
  cloudName: z.string(),
  uploadUrl: z.url(),
  params: z.record(z.string(), z.string()),
  maxBytes: z.number().int(),
  expiresAt: z.iso.datetime(),
});

const retrievalSchema = z.object({
  fileId: z.uuid(),
  url: z.url(),
  expiresAt: z.iso.datetime().nullable(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  category: fileCategorySchema,
});

const grantSchema = z.object({
  id: z.uuid(),
  fileId: z.uuid(),
  granteeUserId: z.uuid().nullable(),
  granteeRole: z.string().nullable(),
  reason: z.string(),
  grantedAt: z.iso.datetime(),
});

const accessLogSchema = z.object({
  occurredAt: z.iso.datetime(),
  accessedByUserId: z.uuid().nullable(),
  accessedByAdminId: z.uuid().nullable(),
  accessGranted: z.boolean(),
  deniedReason: z.string().nullable(),
});

const storageAccountSchema = z.object({
  id: z.uuid(),
  pool: storagePoolSchema,
  label: z.string(),
  cloudName: z.string(),
  credentialEnvPrefix: z.string(),
  status: z.string(),
  rotationOrder: z.number().int().nullable(),
  storageUsedBytes: z.number().int(),
  creditsUsedPct: z.number(),
  lastUsageSyncedAt: z.iso.datetime().nullable(),
});

export function filesRoutes(deps: FilesHttpDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'post',
      path: '/files/upload-url',
      scope: 'CONSUMER',
      summary: 'Signed parameters for a direct-to-Cloudinary upload, and the file id it will hold',
      // Issuing a second ticket wastes a row and a rotation slot, both of which the abandoned sweep
      // reclaims; making the caller carry an idempotency key for a cheap, harmless repeat is worse.
      retryable: false,
      status: 201,
      schema: { body: createUploadUrlBody, response: uploadTicketSchema },
      handler: ({ actor, body }) =>
        controllers.createUploadUrl(deps, {
          uploaderUserId: requireUserId(actor, UPLOAD_A_FILE),
          scope: actor.principal?.scope ?? 'CONSUMER',
          body,
        }),
    }),

    defineRoute({
      method: 'post',
      path: '/files/:id/finalize',
      scope: 'CONSUMER',
      summary: 'Tells the server the upload landed; a job confirms it with Cloudinary',
      // Idempotent by construction: the service returns a READY row unchanged, and the job id is the
      // file id, so a repeat cannot queue a second reconciliation.
      retryable: false,
      status: 202,
      schema: {
        params: fileIdParams,
        response: z.object({ fileId: z.uuid(), uploadState: z.string() }),
      },
      handler: ({ actor, params }) =>
        controllers.finalizeUpload(deps, {
          uploaderUserId: requireUserId(actor, UPLOAD_A_FILE),
          fileId: params.id,
        }),
    }),

    defineRoute({
      method: 'get',
      path: '/files/:id',
      scope: 'CONSUMER',
      summary: 'A short-lived signed URL for a file the caller may see',
      schema: { params: fileIdParams, response: retrievalSchema },
      /**
       * Returns JSON rather than a 302, deliberately. A redirect would put the signed URL in the
       * browser's address bar, its history and every `Referer` header the fetched page generates —
       * for a PRIVATE_CASE dispute photo that is the capability leaking into three places at once.
       */
      handler: ({ actor, params }) => {
        requireUserId(actor, SEE_A_FILE);
        const principal = actor.principal;
        if (!principal) throw new ApiError(401, 'UNAUTHENTICATED', SEE_A_FILE);
        return controllers.retrieve(deps, {
          fileId: params.id,
          subject: controllers.subjectFrom(principal),
        });
      },
    }),

    /**
     * Tombstoning is destructive and, by D4's design, not reversible. `user.close` is the closest
     * existing analogue: an operator removing a user's uploaded evidence is doing the same class of
     * thing as closing their account.
     */
    defineRoute({
      method: 'post',
      path: '/admin/files/:id/tombstone',
      scope: 'STAFF',
      permission: 'user.close',
      summary: 'Removes a file’s bytes and keeps its row resolvable',
      // A second tombstone is a no-op that returns the first one's reason, so there is nothing for an
      // idempotency key to protect.
      retryable: false,
      schema: {
        params: fileIdParams,
        body: tombstoneBody,
        response: z.object({
          fileId: z.uuid(),
          status: z.string(),
          reason: z.string().nullable(),
          tombstonedAt: z.iso.datetime().nullable(),
        }),
      },
      handler: ({ actor, params, body }) =>
        controllers.tombstone(deps, {
          fileId: params.id,
          reason: body.reason,
          actorUserId: requireUserId(actor, 'Sign in to remove a file'),
        }),
    }),

    /** Grants are how a case reaches its participants. `user.update` — this WRITES an authorization fact. */
    defineRoute({
      method: 'post',
      path: '/admin/files/:id/grants',
      scope: 'STAFF',
      permission: 'user.update',
      summary: 'Gives a user or a staff role access to a case file',
      // Idempotent on the live-grant index: a repeat returns the existing row.
      retryable: false,
      status: 201,
      schema: { params: fileIdParams, body: grantAccessBody, response: grantSchema },
      handler: ({ params, body }) =>
        controllers.grant(deps, {
          fileId: params.id,
          ...(body.granteeUserId ? { granteeUserId: body.granteeUserId } : {}),
          ...(body.granteeRole ? { granteeRole: body.granteeRole } : {}),
          reason: body.reason,
        }),
    }),

    defineRoute({
      method: 'get',
      path: '/admin/files/:id/grants',
      scope: 'STAFF',
      permission: 'audit.view',
      summary: 'Who currently has access to a case file',
      paginated: 'cursor',
      schema: { params: fileIdParams, response: paginatedSchema(grantSchema) },
      handler: ({ params, query, cursor }) =>
        controllers.grants(deps, {
          fileId: params.id,
          limit: query.limit ?? DEFAULT_PAGE,
          ...(cursor ? { cursor } : {}),
        }),
    }),

    defineRoute({
      method: 'delete',
      path: '/admin/files/:id/grants/:grantId',
      scope: 'STAFF',
      permission: 'user.update',
      summary: 'Takes a grantee’s access to a case file away',
      // Revoking a revoked grant is a 404, which is the same answer however many times it is sent.
      retryable: false,
      schema: { params: grantIdParams, response: z.object({ revoked: z.literal(true) }) },
      handler: ({ params }) => controllers.revoke(deps, { fileId: params.id, grantId: params.grantId }),
    }),

    /** The compliance read (M20 §3.6). `audit.view`, the same as every other access log here. */
    defineRoute({
      method: 'get',
      path: '/admin/files/:id/access-log',
      scope: 'STAFF',
      permission: 'audit.view',
      summary: 'Who looked at this file, when, and whether they got it',
      paginated: 'cursor',
      schema: { params: fileIdParams, response: paginatedSchema(accessLogSchema) },
      handler: ({ params, query, cursor }) =>
        controllers.accessLog(deps, {
          fileId: params.id,
          limit: query.limit ?? DEFAULT_PAGE,
          ...(cursor ? { cursor } : {}),
        }),
    }),

    defineRoute({
      method: 'get',
      path: '/internal/storage-accounts',
      scope: 'STAFF',
      permission: 'audit.view',
      summary: 'Status and usage for every storage account',
      paginated: 'cursor',
      schema: { response: paginatedSchema(storageAccountSchema) },
      handler: ({ query, cursor }) =>
        controllers.storageAccounts(deps, {
          limit: query.limit ?? DEFAULT_PAGE,
          ...(cursor ? { cursor } : {}),
        }),
    }),

    /**
     * Registering an account is the §5 runbook step, and it is closer to a deployment action than to
     * ordinary operations — a wrong `credential_env_prefix` silently removes an account from
     * rotation. `role.grant` is the narrowest existing permission that lands only on SUPER_ADMIN.
     */
    defineRoute({
      method: 'post',
      path: '/internal/storage-accounts',
      scope: 'STAFF',
      permission: 'role.grant',
      summary: 'Registers a newly provisioned storage account so rotation picks it up',
      // A repeat is a 409 on the label, cloud name or prefix, so a key would protect nothing.
      retryable: false,
      status: 201,
      schema: {
        body: registerStorageAccountBody,
        response: z.object({
          id: z.uuid(),
          pool: storagePoolSchema,
          label: z.string(),
          rotationOrder: z.number().int().nullable(),
        }),
      },
      handler: ({ body }) =>
        controllers.registerStorageAccount(deps, {
          pool: body.pool,
          label: body.label,
          cloudName: body.cloudName,
          credentialEnvPrefix: body.credentialEnvPrefix,
          ...(body.rotationOrder === undefined ? {} : { rotationOrder: body.rotationOrder }),
        }),
    }),
  ];
}
