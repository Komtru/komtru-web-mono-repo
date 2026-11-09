// T-041. The signed-in user's avatar (M1 D7).
//
// `user_profiles.avatar_file_id` is a soft reference to an M20 PROFILE_PHOTO file and NOTHING else is
// stored: the URL is produced by the files module at the moment somebody looks, so it always reflects
// the current avatar and a removed one stops resolving. PROFILE_PHOTO is PUBLIC, so the delivery URL
// is signed but does NOT expire (M20 `signFor`); it is not a capability that lapses. A raw provider URL is never written anywhere; a Google or
// Apple picture is fetched server-side and goes through the same files flow as any upload (M1 section
// 7.4), because a provider can change or revoke its URL without telling us.
//
// IDENTITY CANNOT IMPORT FILES (files imports identity for its scope checks), so everything that needs
// the files module arrives as a PORT, wired once in `modules/index.ts` - the same arrangement T-039 uses
// for `tombstoneUserFiles`.
import type { SessionScope } from '@komtru/shared-types';
import { and, eq, inArray } from 'drizzle-orm';
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
import type { PartyEnrichment } from '../domain/party/card.js';
import { identityProfileAvatarChangedEvent } from '../domain/events.js';
import { userProfiles } from '../infrastructure/postgres/schema/users.js';
import { AUDIT_ACTIONS, writeAudit } from './audit.service.js';
import type { PartyPorts } from './party.service.js';

/** Who is looking: M20 decides access from this, so the avatar is signed for the viewer, not the owner. */
export interface AvatarViewer {
  userId: string;
  scope: SessionScope;
  roles: readonly string[];
}

/** The provider's declared content type is deliberately not carried: the bytes are sniffed. */
export interface ProviderImage {
  bytes: Uint8Array;
}

export interface AvatarPorts {
  /** M20's record for a file, or undefined. The registry wires the files barrel's `findFile`. */
  findFile: (fileId: string) => Promise<AvatarFileView | undefined>;
  /**
   * M20's `retrieveFile(...).url`. Throws the files module's own errors for a missing or removed file.
   * NOT local arithmetic: `retrieveFile` reads the file record and its storage account first, so each
   * call costs database round trips (this matters to `resolveAvatarUrls`, see there).
   */
  signUrl: (fileId: string, viewer: AvatarViewer) => Promise<string>;
  /** M20's `requestTombstone`. */
  tombstone: (fileId: string, reason: string) => Promise<void>;
  /**
   * Provider import, both optional so a deployment without social login wires neither.
   *
   * `fetchImage` is an OUTBOUND request on a URL the provider chose. It receives a URL that already
   * passed `checkProviderImageUrl` (a cheap filter, not the defence) and MUST ITSELF:
   *   1. follow no redirects (a redirect is a new, unchecked URL);
   *   2. refuse any connection whose resolved address is private, loopback or link-local, checking the
   *      address it actually connects to (DNS-pinned), not a separate earlier lookup;
   *   3. stop reading, and reject, once more than `PROVIDER_IMAGE_MAX_BYTES` have arrived, whatever
   *      Content-Length claims or omits;
   *   4. time out as a whole, including a body that trickles.
   * `test/support/fetch-image-contract.ts` is that contract as an executable suite; every
   * implementation (T-034's) must pass it.
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

const record = async (
  tx: Tx,
  input: {
    userId: string;
    fileId: string | null;
    previousFileId: string | null;
    /** Absent on a removal: there is no origin to record. */
    source?: Source;
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
    metadata: {
      fileId: input.fileId,
      previousFileId: input.previousFileId,
      ...(input.source ? { source: input.source } : {}),
    },
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

type Applied = { applied: true; previous: string | null } | { applied: false; reason: 'HAS_AVATAR' };

/**
 * The swap, with every check that must hold AT COMMIT inside the locked transaction.
 *
 * The file is re-read after the row lock is taken: the check before the transaction is what keeps a
 * bad request from locking anything, but a file tombstoned in between (the user's erasure, a staff
 * action) must not become the avatar. The files table is not under our lock, so a tombstone landing
 * after this re-read and before the commit is caught by the post-commit check in `setAvatar`.
 */
async function applyAvatar(
  deps: AvatarDeps,
  input: SetAvatarInput,
  options: { onlyIfNone: boolean },
): Promise<Applied> {
  return deps.db.transaction(async (tx): Promise<Applied> => {
    await tx.insert(userProfiles).values({ userId: input.userId }).onConflictDoNothing();
    const [current] = await tx
      .select({ avatarFileId: userProfiles.avatarFileId })
      .from(userProfiles)
      .where(eq(userProfiles.userId, input.userId))
      .for('update');
    const previous = current?.avatarFileId ?? null;

    // Decided under the lock, so a user upload that landed a moment ago is seen and kept.
    if (options.onlyIfNone && previous) return { applied: false, reason: 'HAS_AVATAR' };

    const recheck = checkAvatarFile(await deps.ports.findFile(input.fileId), input.userId);
    if (!recheck.ok) throw REFUSALS[recheck.reason]();

    // Setting the file already set changes nothing, so it writes nothing: a retried tap is one event.
    if (previous !== input.fileId) {
      await tx
        .update(userProfiles)
        .set({ avatarFileId: input.fileId, updatedAt: new Date() })
        .where(eq(userProfiles.userId, input.userId));
      await record(tx, {
        userId: input.userId,
        fileId: input.fileId,
        previousFileId: previous,
        source: input.source ?? 'UPLOAD',
        request: input.request,
      });
    }
    return { applied: true, previous };
  });
}

/** `POST /me/avatar`. Also the last step of a provider import, so both go through one set of rules. */
export async function setAvatar(deps: AvatarDeps, input: SetAvatarInput): Promise<AvatarResult> {
  const check = checkAvatarFile(await deps.ports.findFile(input.fileId), input.userId);
  if (!check.ok) throw REFUSALS[check.reason]();

  const result = await applyAvatar(deps, input, { onlyIfNone: false });
  return finishSet(deps, input, result);
}

async function finishSet(deps: AvatarDeps, input: SetAvatarInput, result: Applied): Promise<AvatarResult> {
  if (!result.applied) throw new Error('identity: an unconditional avatar swap was not applied');

  if (result.previous !== input.fileId) await retire(deps, result.previous, 'Avatar replaced');

  // A tombstone that landed after the in-transaction re-read: undo, but only if the profile still
  // points at this file (a newer set must not be undone by a stale one).
  const after = checkAvatarFile(await deps.ports.findFile(input.fileId), input.userId);
  if (!after.ok) {
    await deps.db
      .update(userProfiles)
      .set({ avatarFileId: null, updatedAt: new Date() })
      .where(and(eq(userProfiles.userId, input.userId), eq(userProfiles.avatarFileId, input.fileId)));
    throw REFUSALS[after.reason]();
  }

  return { avatarUrl: await sign(deps, input.fileId, selfViewer(input.userId)) };
}

export interface RemoveAvatarInput {
  userId: string;
  request: AvatarRequestContext;
}

/** `DELETE /me/avatar`. No avatar is not an error: the end state is what was asked for. */
export async function removeAvatar(deps: AvatarDeps, input: RemoveAvatarInput): Promise<AvatarResult> {
  const previous = await deps.db.transaction(async (tx) => {
    // The row lock is taken HERE, once; the update below runs under it.
    const [profile] = await tx
      .select({ avatarFileId: userProfiles.avatarFileId })
      .from(userProfiles)
      .where(eq(userProfiles.userId, input.userId))
      .for('update');
    const replaced = profile?.avatarFileId ?? null;
    if (!replaced) return null;
    await tx
      .update(userProfiles)
      .set({ avatarFileId: null, updatedAt: new Date() })
      .where(eq(userProfiles.userId, input.userId));
    await record(tx, {
      userId: input.userId,
      fileId: null,
      previousFileId: replaced,
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

/** A file id no real file has (the nil uuid): the decoy lookup's target. */
const DECOY_FILE_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Avatar URLs for a batch of users, keyed by user id; what a PartyCard's `enrich` calls (T-035).
 * `reader` lets the caller run the profile query on its own transaction.
 *
 * T-035's RULE: `enrich` is called with `[]` on a miss and must do equivalent work, or a found lookup
 * becomes distinguishable from a miss by timing (M1 section 8.3 control 4). Two things keep that true:
 *  - the profile query is issued for an empty list too;
 *  - signing is NOT local (M20's `retrieveFile` reads the file record and its storage account), so a
 *    batch in which nothing needs signing - always the case for `[]`, and for a user with no avatar -
 *    makes ONE decoy `signUrl` against the nil uuid and discards the result, in place of the real one.
 *    A real signing costs a couple of round trips more than the decoy's single lookup: the residual
 *    difference is only visible between "has an avatar" and "does not", never between a hit and a miss
 *    of the same kind, and it is reported to the owner as an open item.
 */
export async function resolveAvatarUrls(
  deps: AvatarDeps,
  userIds: readonly string[],
  viewer: AvatarViewer | ((ownerUserId: string) => AvatarViewer),
  reader: Pick<Db, 'select'> = deps.db,
): Promise<Map<string, string | null>> {
  const rows = await reader
    .select({ userId: userProfiles.userId, avatarFileId: userProfiles.avatarFileId })
    .from(userProfiles)
    .where(inArray(userProfiles.userId, [...userIds]));
  const byUser = new Map(rows.map((row) => [row.userId, row.avatarFileId]));
  const viewerFor = (ownerUserId: string): AvatarViewer =>
    typeof viewer === 'function' ? viewer(ownerUserId) : viewer;

  const out = new Map<string, string | null>();
  let signings = 0;
  await Promise.all(
    userIds.map(async (userId) => {
      const fileId = byUser.get(userId) ?? null;
      if (fileId) signings += 1;
      out.set(userId, await resolveAvatarUrl(deps, fileId, viewerFor(userId)));
    }),
  );

  if (signings === 0) {
    await deps.ports.signUrl(DECOY_FILE_ID, viewerFor(userIds[0] ?? DECOY_FILE_ID)).catch(() => undefined);
  }
  return out;
}

/**
 * `PartyPorts.enrich` for the avatar alone: M7's completed-trade count (T-061) and M5's merchant name
 * (T-055) have no module to come from yet and keep their defaults.
 *
 * Each owner is passed as their own viewer because `enrich` is not told who is looking. That is safe
 * for PROFILE_PHOTO, which is PUBLIC (M20 allows any viewer); an avatar category that was not public
 * would have to widen the port first.
 */
export const avatarEnrichment =
  (deps: AvatarDeps): NonNullable<PartyPorts['enrich']> =>
  async (tx, userIds) => {
    const urls = await resolveAvatarUrls(
      deps,
      userIds,
      (ownerUserId) => ({ userId: ownerUserId, scope: 'CONSUMER', roles: [] }),
      tx,
    );
    return new Map(
      [...urls].map(([userId, avatarUrl]): [string, PartyEnrichment] => [
        userId,
        { completedTrades: 0, merchantName: null, avatarUrl },
      ]),
    );
  };

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

  let ingested: string | null = null;
  try {
    if (input.onlyIfNone) {
      // A cheap early exit to spare the download. The decision that counts is made again under the
      // row lock in `applyAvatar`, where a concurrent upload cannot slip past it.
      const [profile] = await deps.db
        .select({ avatarFileId: userProfiles.avatarFileId })
        .from(userProfiles)
        .where(eq(userProfiles.userId, input.userId));
      if (profile?.avatarFileId) return { status: 'SKIPPED', reason: 'the user already has an avatar' };
    }

    const image = await fetchImage(url.url);
    const verdict = checkProviderImage(image.bytes);
    if (!verdict.ok) return { status: 'SKIPPED', reason: verdict.reason };

    ({ fileId: ingested } = await ingest({
      userId: input.userId,
      contentType: verdict.contentType,
      bytes: image.bytes,
    }));

    const set: SetAvatarInput = {
      userId: input.userId,
      fileId: ingested,
      request: input.request,
      source: input.provider,
    };
    const check = checkAvatarFile(await deps.ports.findFile(ingested), input.userId);
    if (!check.ok) throw REFUSALS[check.reason]();
    const applied = await applyAvatar(deps, set, { onlyIfNone: input.onlyIfNone ?? false });
    if (!applied.applied) {
      await retire(deps, ingested, 'Provider avatar not used: the user chose one first');
      return { status: 'SKIPPED', reason: 'the user already has an avatar' };
    }
    const result = await finishSet(deps, set, applied);
    return { status: 'IMPORTED', avatarUrl: result.avatarUrl };
  } catch (error) {
    // Ingested but never made the avatar: nobody references it, so do not leave it in storage.
    await retire(deps, ingested, 'Provider avatar could not be applied');
    deps.logger.warn(
      { err: error, userId: input.userId, provider: input.provider },
      'identity: provider avatar import failed',
    );
    return { status: 'SKIPPED', reason: 'the provider avatar could not be imported' };
  }
}
