// T-041. The signed-in user's avatar (M1 D7).
//
// `user_profiles.avatar_file_id` is a soft reference to an M20 PROFILE_PHOTO file and NOTHING else is
// stored: the URL is signed by the files module at the moment somebody looks, so it is always
// short-lived and always the current avatar. A raw provider URL is never written anywhere; a Google or
// Apple picture is fetched server-side and goes through the same files flow as any upload (M1 section
// 7.4), because a provider can change or revoke its URL without telling us.
//
// IDENTITY CANNOT IMPORT FILES (files imports identity for its scope checks), so everything that needs
// the files module arrives as a PORT, wired once in `modules/index.ts` - the same arrangement T-039 uses
// for `tombstoneUserFiles`.
import type { SessionScope } from '@komtru/shared-types';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import type { Logger } from '../../../platform/logger.js';
import {
  checkAvatarFile,
  checkProviderImage,
  checkProviderImageUrl,
  type AvatarFileRefusal,
  type AvatarFileView,
} from '../domain/avatar.js';
import { identityProfileAvatarChangedEvent } from '../domain/events.js';
import { userProfiles } from '../infrastructure/postgres/schema/users.js';
import { AUDIT_ACTIONS, writeAudit } from './audit.service.js';

/** Who is looking: M20 decides access from this, so the avatar is signed for the viewer, not the owner. */
export interface AvatarViewer {
  userId: string;
  scope: SessionScope;
  roles: readonly string[];
}

export interface ProviderImage {
  bytes: Uint8Array;
  contentType: string;
}

export interface AvatarPorts {
  /** M20's record for a file, or undefined. The registry wires the files barrel's `findFile`. */
  findFile: (fileId: string) => Promise<AvatarFileView | undefined>;
  /** M20's `retrieveFile(...).url`. Throws the files module's own errors for a missing or removed file. */
  signUrl: (fileId: string, viewer: AvatarViewer) => Promise<string>;
  /** M20's `requestTombstone`. */
  tombstone: (fileId: string, reason: string) => Promise<void>;
  /**
   * Provider import, both optional so a deployment without social login wires neither.
   *
   * `fetchImage` is an OUTBOUND request on a URL the provider chose: it receives a URL that already
   * passed `checkProviderImageUrl`, and must itself refuse redirects and any hostname that resolves to a
   * private address, enforce the 5 MiB cap while reading, and time out.
   */
  fetchImage?: (url: URL) => Promise<ProviderImage>;
  /** Uploads the bytes as a PROFILE_PHOTO owned by `userId`; resolves once the file is READY. */
  ingest?: (input: { userId: string; contentType: string; bytes: Uint8Array }) => Promise<{ fileId: string }>;
}

export interface AvatarDeps {
  db: Db;
  ports: AvatarPorts;
  logger: Logger;
}

export interface AvatarRequestContext {
  ip: string | null;
  userAgent: string | null;
  sessionId: string | null;
}

export interface AvatarResult {
  avatarUrl: string | null;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const REFUSALS: Record<AvatarFileRefusal, () => ApiError> = {
  // Identical for "no such file" and "not yours": the endpoint must not be an existence oracle.
  NOT_FOUND: () => new ApiError(404, 'NOT_FOUND', 'File not found'),
  WRONG_CATEGORY: () =>
    new ApiError(
      422,
      'VALIDATION_FAILED',
      'That file cannot be used as a profile photo',
      'Upload it as a profile photo first.',
    ),
  NOT_READY: () => new ApiError(409, 'CONFLICT', 'That upload has not completed yet'),
  TOMBSTONED: () => new ApiError(410, 'FILE_TOMBSTONED', 'This file has been removed'),
};

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

type Source = 'UPLOAD' | 'GOOGLE' | 'APPLE';

/**
 * Swaps the profile's `avatar_file_id` under a row lock and returns the file it replaced. Creates the
 * profile row if the account has none yet, so the call never depends on registration having made one.
 */
async function swap(tx: Tx, userId: string, next: string | null): Promise<string | null> {
  await tx.insert(userProfiles).values({ userId }).onConflictDoNothing();
  const [current] = await tx
    .select({ avatarFileId: userProfiles.avatarFileId })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .for('update');
  const previous = current?.avatarFileId ?? null;
  if (previous === next) return previous;
  await tx
    .update(userProfiles)
    .set({ avatarFileId: next, updatedAt: new Date() })
    .where(eq(userProfiles.userId, userId));
  return previous;
}

const record = async (
  tx: Tx,
  input: {
    userId: string;
    fileId: string | null;
    previousFileId: string | null;
    source: Source;
    request: AvatarRequestContext;
  },
): Promise<void> => {
  await writeAudit(tx, {
    action: input.fileId ? AUDIT_ACTIONS.AVATAR_SET : AUDIT_ACTIONS.AVATAR_REMOVED,
    outcome: 'SUCCESS',
    actorType: 'USER',
    actorUserId: input.userId,
    subjectUserId: input.userId,
    ip: input.request.ip,
    userAgent: input.request.userAgent,
    sessionId: input.request.sessionId,
    metadata: { fileId: input.fileId, previousFileId: input.previousFileId, source: input.source },
  });
  await publish(tx, identityProfileAvatarChangedEvent, {
    payload: { userId: input.userId, fileId: input.fileId, previousFileId: input.previousFileId },
    aggregateType: 'identity.profile',
    aggregateId: input.userId,
    actor: { type: 'CONSUMER', id: input.userId },
  });
};

/**
 * The old file goes AFTER the commit and its failure never fails the change: the row is the truth, and
 * an orphaned PROFILE_PHOTO is storage waste an operator can sweep, whereas rolling back a new avatar
 * because Cloudinary hiccuped would punish the user for our storage.
 */
async function retire(deps: AvatarDeps, fileId: string | null, reason: string): Promise<void> {
  if (!fileId) return;
  try {
    await deps.ports.tombstone(fileId, reason);
  } catch (error) {
    deps.logger.error({ err: error, fileId }, 'identity: failed to tombstone a replaced avatar file');
  }
}

export interface SetAvatarInput {
  userId: string;
  fileId: string;
  request: AvatarRequestContext;
  /** Where the file came from; recorded in the audit row. */
  source?: Source;
}

/** `POST /me/avatar`. Also the last step of a provider import, so both go through one set of rules. */
export async function setAvatar(deps: AvatarDeps, input: SetAvatarInput): Promise<AvatarResult> {
  const file = await deps.ports.findFile(input.fileId);
  const check = checkAvatarFile(file, input.userId);
  if (!check.ok) throw REFUSALS[check.reason]();

  const previous = await deps.db.transaction(async (tx) => {
    const replaced = await swap(tx, input.userId, input.fileId);
    // Setting the file already set changes nothing, so it writes nothing: a retried tap is one event.
    if (replaced !== input.fileId) {
      await record(tx, {
        userId: input.userId,
        fileId: input.fileId,
        previousFileId: replaced,
        source: input.source ?? 'UPLOAD',
        request: input.request,
      });
    }
    return replaced;
  });

  if (previous !== input.fileId) await retire(deps, previous, 'Avatar replaced');

  return { avatarUrl: await sign(deps, input.fileId, selfViewer(input.userId)) };
}

export interface RemoveAvatarInput {
  userId: string;
  request: AvatarRequestContext;
}

/** `DELETE /me/avatar`. No avatar is not an error: the end state is what was asked for. */
export async function removeAvatar(deps: AvatarDeps, input: RemoveAvatarInput): Promise<AvatarResult> {
  const previous = await deps.db.transaction(async (tx) => {
    const [profile] = await tx
      .select({ avatarFileId: userProfiles.avatarFileId })
      .from(userProfiles)
      .where(eq(userProfiles.userId, input.userId))
      .for('update');
    const replaced = profile?.avatarFileId ?? null;
    if (!replaced) return null;
    await swap(tx, input.userId, null);
    await record(tx, {
      userId: input.userId,
      fileId: null,
      previousFileId: replaced,
      source: 'UPLOAD',
      request: input.request,
    });
    return replaced;
  });

  await retire(deps, previous, 'Avatar removed by the user');
  return { avatarUrl: null };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const selfViewer = (userId: string): AvatarViewer => ({ userId, scope: 'CONSUMER', roles: [] });

/** A URL that cannot be signed (the file was tombstoned, M20 is unwell) is no avatar, not a failed page. */
async function sign(deps: AvatarDeps, fileId: string, viewer: AvatarViewer): Promise<string | null> {
  try {
    return await deps.ports.signUrl(fileId, viewer);
  } catch (error) {
    if (!(error instanceof ApiError)) {
      deps.logger.error({ err: error, fileId }, 'identity: failed to sign an avatar url');
    }
    return null;
  }
}

/** Signs now, every call: there is no cached or stored URL anywhere to go stale (D7). */
export async function resolveAvatarUrl(
  deps: AvatarDeps,
  fileId: string | null,
  viewer: AvatarViewer,
): Promise<string | null> {
  return fileId ? sign(deps, fileId, viewer) : null;
}

/**
 * Avatar URLs for a batch of users, keyed by user id; the function a PartyCard builder's `enrich`
 * calls (T-035). The profile query is issued even for an empty list, for the reason `PartyPorts.enrich`
 * gives: a found lookup must not cost a different number of round trips than a miss.
 */
export async function resolveAvatarUrls(
  deps: AvatarDeps,
  userIds: readonly string[],
  viewer: AvatarViewer,
): Promise<Map<string, string | null>> {
  const rows = await deps.db
    .select({ userId: userProfiles.userId, avatarFileId: userProfiles.avatarFileId })
    .from(userProfiles)
    .where(inArray(userProfiles.userId, [...userIds]));
  const byUser = new Map(rows.map((row) => [row.userId, row.avatarFileId]));
  const out = new Map<string, string | null>();
  await Promise.all(
    userIds.map(async (userId) => {
      out.set(userId, await resolveAvatarUrl(deps, byUser.get(userId) ?? null, viewer));
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Provider avatars
// ---------------------------------------------------------------------------

export interface ImportProviderAvatarInput {
  userId: string;
  provider: 'GOOGLE' | 'APPLE';
  /** The provider's `picture` claim: untrusted input. Never stored. */
  url: string;
  /** Skip, without fetching, when the user already has an avatar (first-login auto-import). */
  onlyIfNone?: boolean;
  request: AvatarRequestContext;
}

export type ImportProviderAvatarOutcome =
  { status: 'IMPORTED'; avatarUrl: string | null } | { status: 'SKIPPED'; reason: string };

/**
 * Fetch the provider's picture server-side, hand the bytes to M20 as a PROFILE_PHOTO, then run the
 * ordinary `setAvatar` on the resulting file (M1 section 7.4).
 *
 * NEVER THROWS. This runs inside a social login; a provider with a dead picture URL must not turn a
 * successful sign-in into an error, so every failure is a `SKIPPED` with a reason the caller may log.
 * The URL itself is not logged (it can carry a token) and not stored.
 */
export async function importProviderAvatar(
  deps: AvatarDeps,
  input: ImportProviderAvatarInput,
): Promise<ImportProviderAvatarOutcome> {
  const { fetchImage, ingest } = deps.ports;
  if (!fetchImage || !ingest)
    return { status: 'SKIPPED', reason: 'provider avatar import is not configured' };

  const url = checkProviderImageUrl(input.url);
  if (!url.ok) return { status: 'SKIPPED', reason: `unsafe url: ${url.reason}` };

  try {
    if (input.onlyIfNone) {
      const [profile] = await deps.db
        .select({ avatarFileId: userProfiles.avatarFileId })
        .from(userProfiles)
        .where(eq(userProfiles.userId, input.userId));
      if (profile?.avatarFileId) return { status: 'SKIPPED', reason: 'the user already has an avatar' };
    }

    const image = await fetchImage(url.url);
    const verdict = checkProviderImage({
      contentType: image.contentType,
      byteLength: image.bytes.byteLength,
    });
    if (!verdict.ok) return { status: 'SKIPPED', reason: verdict.reason };

    const { fileId } = await ingest({
      userId: input.userId,
      contentType: verdict.contentType,
      bytes: image.bytes,
    });
    const result = await setAvatar(deps, {
      userId: input.userId,
      fileId,
      request: input.request,
      source: input.provider,
    });
    return { status: 'IMPORTED', avatarUrl: result.avatarUrl };
  } catch (error) {
    deps.logger.warn(
      { err: error, userId: input.userId, provider: input.provider },
      'identity: provider avatar import failed',
    );
    return { status: 'SKIPPED', reason: 'the provider avatar could not be imported' };
  }
}
