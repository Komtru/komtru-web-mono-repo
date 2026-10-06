// Cannibalized from kumtru/backend-apis/src/modules/files/infrastructure/cloudinary.ts (T-001), the
// network half, rewritten onto `providerRequest` and with every response validated.
//
// This is the ONLY file in the files module that touches the network, which is why it is named
// `*.client.ts`: `komtru/provider-clients` and test/platform/provider-boundaries.test.ts both refuse
// to let anything but `files/jobs/` import it (design §4.4, T-028). The pure half of the adapter —
// upload signing, delivery and download URLs — lives in cloudinary.signing.ts, which a request
// handler may call directly, because computing a signature is arithmetic and not I/O.
//
// HONEST CAVEAT: no call here has ever been made against a live Cloudinary account from this
// repository. Request and response shapes follow Cloudinary's published Admin API documentation;
// every test runs against a local stub server. The first call against a live account is still the
// test that matters, and the field to confirm first is `credits.used_percent` on `GET /usage`,
// which has moved between API versions.
import { z } from 'zod';
import type { FilesConfig } from '../../../../config/env.js';
import type { Logger } from '../../../../platform/logger.js';
import { ProviderHttpError, providerRequest } from '../../../../platform/providers/http.js';
import { StorageAccountUnconfiguredError } from '../../domain/errors.js';
import { credentialsFor } from '../credentials.js';
import {
  CLOUDINARY_API_BASE,
  buildDestroySignature,
  type CloudinaryResourceType,
} from './cloudinary.signing.js';

/** Cloudinary's Admin API can be slow under load; nothing here may hold a job open indefinitely. */
const ADMIN_TIMEOUT_MS = 10_000;

export interface CloudinaryClientOptions {
  files: FilesConfig;
  logger: Logger;
  /** Overridden only by tests, which point it at a local stub server. */
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
}

export interface CloudinaryUsage {
  storageUsedBytes: number;
  creditsUsedPct: number;
}

export interface CloudinaryResource {
  publicId: string;
  bytes: number;
  format: string;
  resourceType: string;
}

export interface ResourceQuery {
  /** The account's `credential_env_prefix` (D7): which of the five holds these bytes. */
  prefix: string;
  publicId: string;
  resourceType: CloudinaryResourceType;
}

export interface CloudinaryClient {
  /** M20 §5's hourly poll. Throws rather than guessing when the account cannot be read. */
  fetchUsage(prefix: string): Promise<CloudinaryUsage>;
  /** `undefined` means Cloudinary has no such asset — an unused ticket, not an error. */
  fetchResource(query: ResourceQuery): Promise<CloudinaryResource | undefined>;
  /** D4's actual deletion. Never throws; see the note on the implementation. */
  destroyAsset(query: ResourceQuery): Promise<boolean>;
}

/** Cloudinary reports credits as `{ usage, limit, used_percent }`; all three are optional in the wild. */
const usageSchema = z.object({
  storage: z.object({ usage: z.number().optional() }).optional(),
  credits: z
    .object({
      usage: z.number().optional(),
      limit: z.number().optional(),
      used_percent: z.number().optional(),
    })
    .optional(),
});

const resourceSchema = z.object({
  public_id: z.string().optional(),
  bytes: z.number().optional(),
  format: z.string().optional(),
  resource_type: z.string().optional(),
});

const destroySchema = z.object({ result: z.string().optional() });

export function createCloudinaryClient(options: CloudinaryClientOptions): CloudinaryClient {
  const base = options.baseUrl ?? CLOUDINARY_API_BASE;
  const common = {
    provider: 'cloudinary',
    timeoutMs: options.timeoutMs ?? ADMIN_TIMEOUT_MS,
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
    ...(options.backoffMs === undefined ? {} : { backoffMs: options.backoffMs }),
  };

  /** Basic auth from the account's own key pair: no shared namespace, no shared credential (D7). */
  const authHeader = (apiKey: string, apiSecret: string): string =>
    `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`;

  const fetchUsage = async (prefix: string): Promise<CloudinaryUsage> => {
    const credentials = credentialsFor(options.files, prefix);
    const response = await providerRequest<unknown>(options.logger, {
      ...common,
      operation: 'usage.read',
      method: 'GET',
      url: `${base}/${credentials.cloudName}/usage`,
      headers: { authorization: authHeader(credentials.apiKey, credentials.apiSecret) },
    });

    const body = usageSchema.parse(response.body);
    const credits = body.credits;
    const derived =
      credits?.limit && credits.limit > 0 ? ((credits.usage ?? 0) / credits.limit) * 100 : undefined;
    const usedPercent = credits?.used_percent ?? derived;

    // Not defaulted to zero on purpose: an account reporting 0% forever is an account that never
    // trips a threshold and fills up in silence. A sync that fails is visible; one that lies is not.
    if (usedPercent === undefined) {
      throw new Error(`cloudinary: usage for ${prefix} reported no credit figures`);
    }

    return {
      storageUsedBytes: body.storage?.usage ?? 0,
      // Clamped and rounded to what the numeric(5,2) column with its 0-100 CHECK can hold.
      creditsUsedPct: Math.min(100, Math.max(0, Number(usedPercent.toFixed(2)))),
    };
  };

  const fetchResource = async (query: ResourceQuery): Promise<CloudinaryResource | undefined> => {
    const credentials = credentialsFor(options.files, query.prefix);
    const url =
      `${base}/${credentials.cloudName}/resources/${query.resourceType}/authenticated/` +
      encodeURIComponent(query.publicId);

    try {
      const response = await providerRequest<unknown>(options.logger, {
        ...common,
        operation: 'resource.read',
        method: 'GET',
        url,
        headers: { authorization: authHeader(credentials.apiKey, credentials.apiSecret) },
      });
      const body = resourceSchema.parse(response.body);
      return {
        publicId: body.public_id ?? query.publicId,
        bytes: body.bytes ?? 0,
        format: body.format ?? '',
        resourceType: body.resource_type ?? query.resourceType,
      };
    } catch (error) {
      // A 404 is the ordinary "the client got a ticket and never used it" case. Anything else is
      // rethrown so the finalize job retries rather than concluding the upload never happened.
      if (error instanceof ProviderHttpError && error.status === 404) return undefined;
      throw error;
    }
  };

  /**
   * Destroys the asset behind a tombstone (D4).
   *
   * NEVER throws. The row is the durable record and the tombstone must land whether or not Cloudinary
   * cooperates — a retention sweep that half-fails and rolls back leaves the file both present and
   * marked for deletion, which is the worst of both. A failure here leaves an orphaned Cloudinary
   * asset, logged at ERROR for an operator to reconcile.
   */
  const destroyAsset = async (query: ResourceQuery): Promise<boolean> => {
    try {
      const credentials = credentialsFor(options.files, query.prefix);
      const body = new URLSearchParams(
        buildDestroySignature({
          credentials,
          publicId: query.publicId,
          timestampSeconds: Math.floor(Date.now() / 1000),
        }),
      ).toString();

      const response = await providerRequest<unknown>(options.logger, {
        ...common,
        operation: 'asset.destroy',
        method: 'POST',
        url: `${base}/${credentials.cloudName}/${query.resourceType}/destroy`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        // A repeated destroy is a no-op on Cloudinary's side, so a retry cannot double-delete.
        idempotent: true,
        body,
      });

      const result = destroySchema.parse(response.body).result;
      // `not found` means the bytes are already gone, which is the only thing the caller asked about.
      if (result === 'ok' || result === 'not found') return true;

      options.logger.error(
        { publicId: query.publicId, account: query.prefix, result },
        'files: cloudinary destroy did not confirm — asset may be orphaned, row is still tombstoned',
      );
      return false;
    } catch (error) {
      const missing = error instanceof StorageAccountUnconfiguredError;
      options.logger.error(
        {
          err: error,
          publicId: query.publicId,
          account: query.prefix,
          ...(missing ? { missingVariables: error.missingVariables } : {}),
        },
        'files: cloudinary destroy failed — asset is orphaned, row is still tombstoned',
      );
      return false;
    }
  };

  return { fetchUsage, fetchResource, destroyAsset };
}
