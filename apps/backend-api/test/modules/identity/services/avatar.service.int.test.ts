// T-041 against the real database: setting, replacing and removing an avatar, read-time signing and the
// server-side provider import. The files module is replaced by fake ports (identity cannot import it);
// the registry's wiring of the real ones is covered by the module tests. Skipped unless
// KOMTRU_INFRA_TESTS=1.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvatarFileView } from '../../../../src/modules/identity/domain/avatar.js';
import {
  importProviderAvatar,
  removeAvatar,
  resolveAvatarUrl,
  resolveAvatarUrls,
  setAvatar,
  type AvatarDeps,
  type AvatarPorts,
  type AvatarRequestContext,
} from '../../../../src/modules/identity/services/avatar.service.js';
import { ApiError } from '../../../../src/platform/errors.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { testLogger, seedUser } from '../support.js';

const REQUEST: AvatarRequestContext = { ip: '203.0.113.7', userAgent: 'vitest', sessionId: null };
const f = (n: number) => `0190b0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe.runIf(infraEnabled)('avatars (T-041)', () => {
  const t = useTestDatabase();
  let files: Map<string, AvatarFileView>;
  let signed: string[];
  let tombstoned: { fileId: string; reason: string }[];
  let ports: AvatarPorts;

  const deps = (over: Partial<AvatarPorts> = {}): AvatarDeps => ({
    db: t.db(),
    logger: testLogger,
    ports: { ...ports, ...over },
  });

  const addFile = (id: string, uploaderUserId: string, over: Partial<AvatarFileView> = {}) => {
    files.set(id, {
      id,
      category: 'PROFILE_PHOTO',
      uploaderUserId,
      uploadState: 'READY',
      status: 'ACTIVE',
      ...over,
    });
    return id;
  };

  const profileAvatar = async (userId: string): Promise<string | null | undefined> => {
    const { rows } = await t
      .owner()
      .query<{ avatar_file_id: string | null }>(
        `SELECT avatar_file_id FROM identity.user_profiles WHERE user_id = $1`,
        [userId],
      );
    return rows[0] ? rows[0].avatar_file_id : undefined;
  };

  const failure = async (promise: Promise<unknown>): Promise<ApiError> => {
    try {
      await promise;
    } catch (error) {
      if (error instanceof ApiError) return error;
      throw error;
    }
    throw new Error('expected the call to fail');
  };

  beforeEach(() => {
    files = new Map();
    signed = [];
    tombstoned = [];
    ports = {
      findFile: (fileId) => Promise.resolve(files.get(fileId)),
      signUrl: (fileId) => {
        signed.push(fileId);
        return Promise.resolve(`https://cdn.test/${fileId}?sig=abc`);
      },
      tombstone: (fileId, reason) => {
        tombstoned.push({ fileId, reason });
        return Promise.resolve();
      },
    };
  });

  describe('setAvatar', () => {
    it('stores the file id (never a url) and answers a freshly signed url', async () => {
      const { userId } = await seedUser(t.owner());
      const fileId = addFile(f(1), userId);

      const result = await setAvatar(deps(), { userId, fileId, request: REQUEST });

      expect(result).toEqual({ avatarUrl: `https://cdn.test/${fileId}?sig=abc` });
      expect(await profileAvatar(userId)).toBe(fileId);
      const { rows } = await t
        .owner()
        .query(`SELECT * FROM identity.user_profiles WHERE user_id = $1`, [userId]);
      expect(JSON.stringify(rows)).not.toContain('cdn.test');
    });

    it('works for an account whose profile row does not exist yet', async () => {
      const { userId } = await seedUser(t.owner());
      expect(await profileAvatar(userId)).toBeUndefined();
      await setAvatar(deps(), { userId, fileId: addFile(f(1), userId), request: REQUEST });
      expect(await profileAvatar(userId)).toBe(f(1));
    });

    it('refuses another user’s file and an unknown file with the same 404', async () => {
      const { userId } = await seedUser(t.owner());
      const other = await seedUser(t.owner());
      addFile(f(1), other.userId);

      const theirs = await failure(setAvatar(deps(), { userId, fileId: f(1), request: REQUEST }));
      const missing = await failure(setAvatar(deps(), { userId, fileId: f(2), request: REQUEST }));

      expect(theirs.status).toBe(404);
      expect(missing.status).toBe(404);
      expect({ ...theirs, stack: undefined }).toEqual({ ...missing, stack: undefined });
      expect(await profileAvatar(userId)).toBeUndefined();
    });

    it('refuses another category (422), an unfinished upload (409) and a tombstoned file (410)', async () => {
      const { userId } = await seedUser(t.owner());
      addFile(f(1), userId, { category: 'KYC_DOCUMENT' });
      addFile(f(2), userId, { uploadState: 'PENDING' });
      addFile(f(3), userId, { status: 'TOMBSTONED' });

      expect((await failure(setAvatar(deps(), { userId, fileId: f(1), request: REQUEST }))).status).toBe(422);
      expect((await failure(setAvatar(deps(), { userId, fileId: f(2), request: REQUEST }))).status).toBe(409);
      expect((await failure(setAvatar(deps(), { userId, fileId: f(3), request: REQUEST }))).status).toBe(410);
      expect(await profileAvatar(userId)).toBeUndefined();
      expect(tombstoned).toEqual([]);
    });

    it('replaces an avatar, tombstoning the previous file after the commit', async () => {
      const { userId } = await seedUser(t.owner());
      await setAvatar(deps(), { userId, fileId: addFile(f(1), userId), request: REQUEST });
      await setAvatar(deps(), { userId, fileId: addFile(f(2), userId), request: REQUEST });

      expect(await profileAvatar(userId)).toBe(f(2));
      expect(tombstoned).toEqual([{ fileId: f(1), reason: 'Avatar replaced' }]);
    });

    it('is a no-op when the same file is set again: no event, no audit row, no tombstone', async () => {
      const { userId } = await seedUser(t.owner());
      const fileId = addFile(f(1), userId);
      await setAvatar(deps(), { userId, fileId, request: REQUEST });
      const again = await setAvatar(deps(), { userId, fileId, request: REQUEST });

      expect(again.avatarUrl).toContain(fileId);
      const events = await t
        .owner()
        .query(`SELECT 1 FROM platform.outbox WHERE event_type = 'identity.profile.avatar_changed'`);
      const audits = await t
        .owner()
        .query(`SELECT 1 FROM identity.identity_audit_log WHERE action = 'AVATAR_SET'`);
      expect(events.rowCount).toBe(1);
      expect(audits.rowCount).toBe(1);
      expect(tombstoned).toEqual([]);
    });

    it('still succeeds when tombstoning the old file fails', async () => {
      const { userId } = await seedUser(t.owner());
      await setAvatar(deps(), { userId, fileId: addFile(f(1), userId), request: REQUEST });
      const failing = deps({ tombstone: () => Promise.reject(new Error('cloudinary down')) });

      await expect(
        setAvatar(failing, { userId, fileId: addFile(f(2), userId), request: REQUEST }),
      ).resolves.toBeDefined();
      expect(await profileAvatar(userId)).toBe(f(2));
    });

    it('writes one event and one audit row carrying ids only', async () => {
      const { userId } = await seedUser(t.owner());
      await setAvatar(deps(), { userId, fileId: addFile(f(1), userId), request: REQUEST });
      await setAvatar(deps(), { userId, fileId: addFile(f(2), userId), request: REQUEST });

      const events = await t
        .owner()
        .query<{ payload: unknown }>(
          `SELECT payload FROM platform.outbox WHERE event_type = 'identity.profile.avatar_changed' ORDER BY occurred_at`,
        );
      expect(events.rows.map((r) => r.payload)).toEqual([
        { userId, fileId: f(1), previousFileId: null },
        { userId, fileId: f(2), previousFileId: f(1) },
      ]);
      const audits = await t
        .owner()
        .query<{ action: string; metadata: unknown }>(
          `SELECT action, metadata FROM identity.identity_audit_log WHERE action LIKE 'AVATAR_%' ORDER BY occurred_at`,
        );
      expect(audits.rows.map((r) => r.action)).toEqual(['AVATAR_SET', 'AVATAR_SET']);
      expect(JSON.stringify(audits.rows)).not.toMatch(/https?:/);
    });
  });

  describe('removeAvatar', () => {
    it('clears the reference, tombstones the file and answers a null url', async () => {
      const { userId } = await seedUser(t.owner());
      await setAvatar(deps(), { userId, fileId: addFile(f(1), userId), request: REQUEST });

      expect(await removeAvatar(deps(), { userId, request: REQUEST })).toEqual({ avatarUrl: null });
      expect(await profileAvatar(userId)).toBeNull();
      expect(tombstoned).toEqual([{ fileId: f(1), reason: 'Avatar removed by the user' }]);
      const events = await t
        .owner()
        .query<{ payload: unknown }>(
          `SELECT payload FROM platform.outbox WHERE event_type = 'identity.profile.avatar_changed' ORDER BY occurred_at DESC LIMIT 1`,
        );
      expect(events.rows[0]?.payload).toEqual({ userId, fileId: null, previousFileId: f(1) });
    });

    it('is a quiet no-op when there is no avatar', async () => {
      const { userId } = await seedUser(t.owner());
      expect(await removeAvatar(deps(), { userId, request: REQUEST })).toEqual({ avatarUrl: null });
      const audits = await t
        .owner()
        .query(`SELECT 1 FROM identity.identity_audit_log WHERE action = 'AVATAR_REMOVED'`);
      expect(audits.rowCount).toBe(0);
      expect(tombstoned).toEqual([]);
    });
  });

  describe('read-time resolution', () => {
    const viewer = { userId: f(900), scope: 'CONSUMER' as const, roles: [] as string[] };

    it('signs at the moment of the call, once per call, and never caches', async () => {
      await expect(resolveAvatarUrl(deps(), f(1), viewer)).resolves.toBe(
        'https://cdn.test/' + f(1) + '?sig=abc',
      );
      await resolveAvatarUrl(deps(), f(1), viewer);
      expect(signed).toEqual([f(1), f(1)]);
    });

    it('is null without a file id, and null (not an error) when the file cannot be signed', async () => {
      expect(await resolveAvatarUrl(deps(), null, viewer)).toBeNull();
      const gone = deps({ signUrl: () => Promise.reject(new ApiError(410, 'FILE_TOMBSTONED', 'removed')) });
      expect(await resolveAvatarUrl(gone, f(1), viewer)).toBeNull();
    });

    it('resolves a batch keyed by user id, issuing the lookup even for an empty list', async () => {
      const a = await seedUser(t.owner());
      const b = await seedUser(t.owner());
      const c = await seedUser(t.owner());
      await setAvatar(deps(), { userId: a.userId, fileId: addFile(f(1), a.userId), request: REQUEST });
      await setAvatar(deps(), { userId: b.userId, fileId: addFile(f(2), b.userId), request: REQUEST });
      signed.length = 0;

      const urls = await resolveAvatarUrls(deps(), [a.userId, b.userId, c.userId], viewer);

      expect(urls.get(a.userId)).toContain(f(1));
      expect(urls.get(b.userId)).toContain(f(2));
      expect(urls.get(c.userId)).toBeNull();
      expect(signed.sort()).toEqual([f(1), f(2)]);
      await expect(resolveAvatarUrls(deps(), [], viewer)).resolves.toEqual(new Map());
    });
  });

  describe('importProviderAvatar (called by social login, T-034)', () => {
    const GOOGLE = 'https://lh3.googleusercontent.com/a/abc=s96-c';
    const image = { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' };

    const importPorts = (userId: string) => {
      const fetchImage = vi.fn((url: URL) => {
        void url;
        return Promise.resolve(image);
      });
      const ingest = vi.fn((input: { userId: string; contentType: string; bytes: Uint8Array }) => {
        void input;
        return Promise.resolve({ fileId: addFile(f(50), userId) });
      });
      return { fetchImage, ingest };
    };

    it('fetches server-side, ingests through the files port and runs the same set-avatar flow', async () => {
      const { userId } = await seedUser(t.owner());
      const { fetchImage, ingest } = importPorts(userId);

      const outcome = await importProviderAvatar(deps({ fetchImage, ingest }), {
        userId,
        provider: 'GOOGLE',
        url: GOOGLE,
        request: REQUEST,
      });

      expect(outcome).toEqual({ status: 'IMPORTED', avatarUrl: `https://cdn.test/${f(50)}?sig=abc` });
      expect(fetchImage).toHaveBeenCalledWith(new URL(GOOGLE));
      expect(ingest).toHaveBeenCalledWith({ userId, contentType: 'image/jpeg', bytes: image.bytes });
      expect(await profileAvatar(userId)).toBe(f(50));
      const { rows } = await t
        .owner()
        .query(`SELECT * FROM identity.user_profiles WHERE user_id = $1`, [userId]);
      expect(JSON.stringify(rows)).not.toContain('googleusercontent');
      const audit = await t
        .owner()
        .query<{ metadata: { source?: string } }>(
          `SELECT metadata FROM identity.identity_audit_log WHERE action = 'AVATAR_SET'`,
        );
      expect(audit.rows[0]?.metadata.source).toBe('GOOGLE');
      expect(JSON.stringify(audit.rows)).not.toContain('googleusercontent');
    });

    it('never fetches an unsafe url', async () => {
      const { userId } = await seedUser(t.owner());
      const { fetchImage, ingest } = importPorts(userId);

      const outcome = await importProviderAvatar(deps({ fetchImage, ingest }), {
        userId,
        provider: 'GOOGLE',
        url: 'https://169.254.169.254/latest/meta-data',
        request: REQUEST,
      });

      expect(outcome.status).toBe('SKIPPED');
      expect(fetchImage).not.toHaveBeenCalled();
      expect(ingest).not.toHaveBeenCalled();
    });

    it('skips, and ingests nothing, when the image is the wrong type or too big', async () => {
      const { userId } = await seedUser(t.owner());
      const { ingest } = importPorts(userId);
      const svg = vi.fn(() => Promise.resolve({ bytes: new Uint8Array([1]), contentType: 'image/svg+xml' }));
      const big = vi.fn(() =>
        Promise.resolve({ bytes: new Uint8Array(5 * 1024 * 1024 + 1), contentType: 'image/png' }),
      );

      for (const fetchImage of [svg, big]) {
        const outcome = await importProviderAvatar(deps({ fetchImage, ingest }), {
          userId,
          provider: 'APPLE',
          url: GOOGLE,
          request: REQUEST,
        });
        expect(outcome.status).toBe('SKIPPED');
      }
      expect(ingest).not.toHaveBeenCalled();
    });

    it('never throws when the provider or the files port fails: the login that called it must go on', async () => {
      const { userId } = await seedUser(t.owner());
      const down = vi.fn(() => Promise.reject(new Error('timeout')));
      const { ingest } = importPorts(userId);
      const first = await importProviderAvatar(deps({ fetchImage: down, ingest }), {
        userId,
        provider: 'GOOGLE',
        url: GOOGLE,
        request: REQUEST,
      });
      const { fetchImage } = importPorts(userId);
      const broken = vi.fn(() => Promise.reject(new Error('cloudinary down')));
      const second = await importProviderAvatar(deps({ fetchImage, ingest: broken }), {
        userId,
        provider: 'GOOGLE',
        url: GOOGLE,
        request: REQUEST,
      });

      expect(first.status).toBe('SKIPPED');
      expect(second.status).toBe('SKIPPED');
      expect(await profileAvatar(userId)).toBeUndefined();
    });

    it('leaves an avatar the user already chose alone when asked to import only if empty', async () => {
      const { userId } = await seedUser(t.owner());
      await setAvatar(deps(), { userId, fileId: addFile(f(1), userId), request: REQUEST });
      const { fetchImage, ingest } = importPorts(userId);

      const outcome = await importProviderAvatar(deps({ fetchImage, ingest }), {
        userId,
        provider: 'GOOGLE',
        url: GOOGLE,
        onlyIfNone: true,
        request: REQUEST,
      });

      expect(outcome.status).toBe('SKIPPED');
      expect(fetchImage).not.toHaveBeenCalled();
      expect(await profileAvatar(userId)).toBe(f(1));
    });

    it('skips when the deployment has not wired the import ports', async () => {
      const { userId } = await seedUser(t.owner());
      const outcome = await importProviderAvatar(deps(), {
        userId,
        provider: 'GOOGLE',
        url: GOOGLE,
        request: REQUEST,
      });
      expect(outcome).toMatchObject({ status: 'SKIPPED' });
    });
  });
});
