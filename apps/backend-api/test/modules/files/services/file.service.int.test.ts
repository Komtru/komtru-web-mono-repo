// The upload half of M20 §6: a ticket, a confirmation that is checked against Cloudinary rather than
// against the client, and a tombstone that keeps the row resolvable. Skipped unless
// KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { FilesConfig } from '../../../../src/config/env.js';
import { createDb, type Db } from '../../../../src/db/index.js';
import { outbox } from '../../../../src/db/platform-schema.js';
import { createLogger } from '../../../../src/platform/logger.js';
import { ApiError } from '../../../../src/platform/errors.js';
import {
  applyReconciliation,
  createUploadTicket,
  findFile,
  findServableFile,
  purgeAbandonedUploads,
  requestFinalize,
  requestTombstone,
  tombstoneByUploader,
} from '../../../../src/modules/files/services/file.service.js';
import { seedStorageAccounts } from '../../../../src/modules/files/services/account.service.js';
import { fileRecords } from '../../../../src/modules/files/infrastructure/postgres/schema/index.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';

const logger = createLogger({ log: { level: 'silent', format: 'json' } } as never);

const files: FilesConfig = {
  accounts: Object.fromEntries(
    [
      'CLOUDINARY_PROFILE',
      'CLOUDINARY_CHAT',
      'CLOUDINARY_TRADE_1',
      'CLOUDINARY_TRADE_2',
      'CLOUDINARY_TRADE_3',
    ].map((prefix) => [prefix, { cloudName: `c-${prefix}`, apiKey: '1234', apiSecret: 'not-a-real-secret' }]),
  ),
  maxUploadBytes: 1_000_000,
  uploadTicketTtlMinutes: 30,
  signedUrlTtlSeconds: 300,
  quota: { nearPct: 85, disabledPct: 97 },
};

describe.runIf(infraEnabled)('file.service', () => {
  const t = useTestDatabase();
  const db = (): Db => createDb(t.app());

  const seeded = async () => {
    await seedStorageAccounts(db(), files, logger);
  };

  const ticket = async (overrides: Partial<Parameters<typeof createUploadTicket>[2]> = {}) => {
    await seeded();
    return createUploadTicket(
      db(),
      { files },
      {
        uploaderUserId: randomUUID(),
        category: 'KYC_DOCUMENT',
        visibility: 'PRIVATE_OWNER',
        contentType: 'application/pdf',
        ...overrides,
      },
    );
  };

  const row = async (fileId: string) => {
    const found = await findFile(db(), fileId);
    if (!found) throw new Error('no such file row');
    return found;
  };

  const outboxTypes = async (): Promise<string[]> =>
    (await db().select().from(outbox)).map((event) => event.eventType);

  describe('createUploadTicket', () => {
    it('pins the account, writes a PENDING row and returns a signed payload', async () => {
      const issued = await ticket();
      const record = await row(issued.fileId);
      expect(record.uploadState).toBe('PENDING');
      expect(record.sizeBytes).toBe(0);
      expect(record.storageAccountId).toBeTruthy();
      expect(issued.params.type).toBe('authenticated');
      expect(issued.uploadUrl).toContain(issued.cloudName);
    });

    it('derives owning_module from the category rather than taking it from the caller', async () => {
      const issued = await ticket({
        category: 'CUSTODY_EVIDENCE',
        visibility: 'PRIVATE_CASE',
        contentType: 'image/jpeg',
      });
      expect((await row(issued.fileId)).owningModule).toBe('park');
    });

    it('generates an opaque storage_object_id with nothing user-identifying in it', async () => {
      const first = await ticket();
      const second = await ticket();
      const ids = [(await row(first.fileId)).storageObjectId, (await row(second.fileId)).storageObjectId];
      for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/);
      expect(ids[0]).not.toBe(ids[1]);
    });

    it('refuses a content type the category does not allow', async () => {
      await expect(
        ticket({ category: 'CUSTODY_EVIDENCE', visibility: 'PRIVATE_CASE', contentType: 'application/pdf' }),
      ).rejects.toBeInstanceOf(ApiError);
    });

    it('refuses a visibility the category does not allow', async () => {
      await expect(ticket({ category: 'KYC_DOCUMENT', visibility: 'PUBLIC' })).rejects.toBeInstanceOf(
        ApiError,
      );
    });

    it('records the hub id a caller resolved server-side', async () => {
      const hubId = randomUUID();
      const issued = await ticket({
        category: 'CUSTODY_EVIDENCE',
        visibility: 'PRIVATE_CASE',
        contentType: 'image/jpeg',
        captureHubId: hubId,
      });
      expect((await row(issued.fileId)).captureHubId).toBe(hubId);
    });

    it('refuses a hub id on a category that cannot have been captured at one', async () => {
      await expect(ticket({ captureHubId: randomUUID() })).rejects.toBeInstanceOf(ApiError);
    });

    it('publishes nothing until the bytes land', async () => {
      await ticket();
      expect(await outboxTypes()).toEqual([]);
    });
  });

  describe('requestFinalize', () => {
    it('moves the row to RECONCILING and stamps capture_received_at from the database clock', async () => {
      // The ticket's sixth bullet: the client's clock is never trusted, so the only timestamp stored
      // is the one the server took when it was first told the bytes had landed — and it comes from
      // the DATABASE clock, so it lines up with created_at, granted_at and occurred_at for an
      // investigator reading the rows side by side. Bracketing it between two `select now()` is what
      // distinguishes that from a pod's own clock, which an `instanceof Date` check cannot.
      const issued = await ticket({
        category: 'CUSTODY_EVIDENCE',
        visibility: 'PRIVATE_CASE',
        contentType: 'image/jpeg',
      });
      const before = await row(issued.fileId);
      const dbNow = async (): Promise<Date> => {
        const { rows } = await t.app().query<{ now: Date }>('SELECT now() AS now');
        if (!rows[0]) throw new Error('no now()');
        return rows[0].now;
      };

      const openedAt = await dbNow();
      const updated = await requestFinalize(db(), {
        fileId: issued.fileId,
        uploaderUserId: before.uploaderUserId,
      });
      const closedAt = await dbNow();

      expect(updated.uploadState).toBe('RECONCILING');
      expect(updated.captureReceivedAt).toBeInstanceOf(Date);
      const stamped = updated.captureReceivedAt!.getTime();
      expect(stamped).toBeGreaterThanOrEqual(openedAt.getTime());
      expect(stamped).toBeLessThanOrEqual(closedAt.getTime());
    });

    it('keeps the first capture stamp when finalize is retried', async () => {
      const issued = await ticket({
        category: 'CUSTODY_EVIDENCE',
        visibility: 'PRIVATE_CASE',
        contentType: 'image/jpeg',
      });
      const { uploaderUserId } = await row(issued.fileId);
      const first = await requestFinalize(db(), { fileId: issued.fileId, uploaderUserId });
      const second = await requestFinalize(db(), { fileId: issued.fileId, uploaderUserId });
      expect(second.captureReceivedAt?.getTime()).toBe(first.captureReceivedAt?.getTime());
    });

    it('refuses another user’s ticket with the same 404 as a file that does not exist', async () => {
      const issued = await ticket();
      const mine = requestFinalize(db(), { fileId: issued.fileId, uploaderUserId: randomUUID() });
      const missing = requestFinalize(db(), { fileId: randomUUID(), uploaderUserId: randomUUID() });
      const [a, b] = await Promise.all([mine.catch((e: unknown) => e), missing.catch((e: unknown) => e)]);
      expect((a as ApiError).status).toBe(404);
      expect((b as ApiError).status).toBe(404);
      expect((a as ApiError).title).toBe((b as ApiError).title);
    });

    it('is idempotent once the file is READY', async () => {
      const issued = await ticket();
      const record = await row(issued.fileId);
      await requestFinalize(db(), { fileId: issued.fileId, uploaderUserId: record.uploaderUserId });
      await applyReconciliation(db(), {
        fileId: issued.fileId,
        maxUploadBytes: files.maxUploadBytes,
        resource: { publicId: record.storageObjectId, bytes: 2048, format: 'pdf', resourceType: 'image' },
      });
      const again = await requestFinalize(db(), {
        fileId: issued.fileId,
        uploaderUserId: record.uploaderUserId,
      });
      expect(again.uploadState).toBe('READY');
      expect((await outboxTypes()).filter((type) => type === 'files.file.uploaded')).toHaveLength(1);
    });

    it('refuses to finalize a tombstoned file', async () => {
      const issued = await ticket();
      const record = await row(issued.fileId);
      await requestTombstone(db(), { fileId: issued.fileId, reason: 'test' });
      await expect(
        requestFinalize(db(), { fileId: issued.fileId, uploaderUserId: record.uploaderUserId }),
      ).rejects.toMatchObject({ status: 410 });
    });
  });

  describe('applyReconciliation', () => {
    const reconcile = async (
      fileId: string,
      resource: { bytes: number; format: string } | undefined,
      publicId = 'ignored',
    ) =>
      applyReconciliation(db(), {
        fileId,
        maxUploadBytes: files.maxUploadBytes,
        resource: resource ? { publicId, resourceType: 'image', ...resource } : undefined,
      });

    it('writes the size and the type Cloudinary actually received', async () => {
      // The client declared image/jpeg when it asked for the ticket; Cloudinary says png. What
      // landed is what the row must hold — the client picks the declared type and can lie about it.
      const issued = await ticket({
        category: 'LISTING_IMAGE',
        visibility: 'PUBLIC',
        contentType: 'image/jpeg',
      });
      const outcome = await reconcile(issued.fileId, { bytes: 4096, format: 'png' });
      expect(outcome.outcome).toBe('READY');
      const record = await row(issued.fileId);
      expect(record).toMatchObject({ uploadState: 'READY', sizeBytes: 4096, contentType: 'image/png' });
      expect(record.finalizedAt).toBeInstanceOf(Date);
    });

    it('publishes files.file.uploaded exactly once, on the transition to READY', async () => {
      const issued = await ticket();
      await reconcile(issued.fileId, { bytes: 10, format: 'pdf' });
      await reconcile(issued.fileId, { bytes: 10, format: 'pdf' });
      expect((await outboxTypes()).filter((type) => type === 'files.file.uploaded')).toHaveLength(1);
    });

    it('rejects and tombstones a file whose real type the category does not allow', async () => {
      // An HTML file uploaded as a KYC_DOCUMENT is stored XSS the moment anything renders it inline.
      const issued = await ticket({
        category: 'CUSTODY_EVIDENCE',
        visibility: 'PRIVATE_CASE',
        contentType: 'image/jpeg',
      });
      const outcome = await reconcile(issued.fileId, { bytes: 10, format: 'pdf' });
      expect(outcome.outcome).toBe('REJECTED');
      expect(await row(issued.fileId)).toMatchObject({ uploadState: 'REJECTED', status: 'TOMBSTONED' });
    });

    it('rejects and tombstones a file larger than the ceiling', async () => {
      // Cloudinary's upload API has no size parameter outside an upload preset, so the bytes are
      // already stored and already metered by the time we can see them. Reclaiming the space and
      // refusing the reference is the best available outcome, not a good one.
      const issued = await ticket();
      const outcome = await reconcile(issued.fileId, { bytes: files.maxUploadBytes + 1, format: 'pdf' });
      expect(outcome.outcome).toBe('REJECTED');
      expect(await row(issued.fileId)).toMatchObject({ status: 'TOMBSTONED' });
    });

    it('reports MISSING and leaves the row alone when Cloudinary has no such asset', async () => {
      const issued = await ticket();
      expect((await reconcile(issued.fileId, undefined)).outcome).toBe('MISSING');
      expect(await row(issued.fileId)).toMatchObject({ uploadState: 'PENDING', status: 'ACTIVE' });
    });

    it('refuses a format it cannot map to a content type', async () => {
      const issued = await ticket();
      expect((await reconcile(issued.fileId, { bytes: 10, format: 'svg' })).outcome).toBe('REJECTED');
    });
  });

  describe('findServableFile', () => {
    it('answers only for a READY, ACTIVE row', async () => {
      const issued = await ticket();
      expect(await findServableFile(db(), issued.fileId)).toBeUndefined();
      await applyReconciliation(db(), {
        fileId: issued.fileId,
        maxUploadBytes: files.maxUploadBytes,
        resource: { publicId: 'x', bytes: 10, format: 'pdf', resourceType: 'image' },
      });
      expect(await findServableFile(db(), issued.fileId)).toBeTruthy();
    });
  });

  describe('requestTombstone', () => {
    it('marks the row and keeps it resolvable (D4)', async () => {
      const issued = await ticket();
      const tombstoned = await requestTombstone(db(), { fileId: issued.fileId, reason: 'retention policy' });
      expect(tombstoned).toMatchObject({ status: 'TOMBSTONED', tombstonedReason: 'retention policy' });
      // The row survives, so every soft `file_ref_id` still resolves to "this existed and was removed".
      expect(await findFile(db(), issued.fileId)).toBeTruthy();
      expect(await outboxTypes()).toContain('files.file.tombstoned');
    });

    it('is idempotent and publishes once', async () => {
      const issued = await ticket();
      await requestTombstone(db(), { fileId: issued.fileId, reason: 'first' });
      await requestTombstone(db(), { fileId: issued.fileId, reason: 'second' });
      expect(await row(issued.fileId)).toMatchObject({ tombstonedReason: 'first' });
      expect((await outboxTypes()).filter((type) => type === 'files.file.tombstoned')).toHaveLength(1);
    });

    it('tombstones every file a user uploaded, and says which', async () => {
      const uploaderUserId = randomUUID();
      const first = await ticket({ uploaderUserId });
      const second = await ticket({ uploaderUserId });
      await ticket();
      const acted = await tombstoneByUploader(db(), { uploaderUserId, reason: 'dsr delete' });
      expect(acted.sort()).toEqual([first.fileId, second.fileId].sort());
    });
  });

  describe('every tombstone path publishes the event the destroy job hangs off', () => {
    // This is the assertion whose absence let three of the four tombstone paths ship without ever
    // destroying the Cloudinary asset. module.ts subscribes to files.file.tombstoned and enqueues
    // the destroy from there, so "did this path publish" IS "will the bytes be destroyed".
    const tombstoneEvents = async (): Promise<{ fileId: string }[]> =>
      (await db().select().from(outbox))
        .filter((event) => event.eventType === 'files.file.tombstoned')
        .map((event) => event.payload as { fileId: string });

    it('publishes for the admin tombstone', async () => {
      const issued = await ticket();
      await requestTombstone(db(), { fileId: issued.fileId, reason: 'admin removed it' });
      expect((await tombstoneEvents()).map((p) => p.fileId)).toEqual([issued.fileId]);
    });

    it('publishes for a data-subject deletion', async () => {
      // The NDPR path. Without the event the user's KYC document stays in Cloudinary after we have
      // told them it was deleted.
      const uploaderUserId = randomUUID();
      const first = await ticket({ uploaderUserId });
      const second = await ticket({ uploaderUserId });
      await tombstoneByUploader(db(), { uploaderUserId, reason: 'dsr delete' });
      expect((await tombstoneEvents()).map((p) => p.fileId).sort()).toEqual(
        [first.fileId, second.fileId].sort(),
      );
    });

    it('publishes for the abandoned-ticket sweep', async () => {
      const issued = await ticket();
      await db()
        .update(fileRecords)
        .set({ createdAt: new Date(Date.now() - 60 * 60_000) })
        .where(eq(fileRecords.id, issued.fileId));
      await purgeAbandonedUploads(db(), files.uploadTicketTtlMinutes);
      expect((await tombstoneEvents()).map((p) => p.fileId)).toEqual([issued.fileId]);
    });

    it('publishes for a rejected reconciliation, where the bytes definitely exist', async () => {
      const issued = await ticket();
      await applyReconciliation(db(), {
        fileId: issued.fileId,
        maxUploadBytes: files.maxUploadBytes,
        resource: {
          publicId: 'x',
          bytes: files.maxUploadBytes + 1,
          format: 'pdf',
          resourceType: 'image',
        },
      });
      expect((await tombstoneEvents()).map((p) => p.fileId)).toEqual([issued.fileId]);
    });
  });

  describe('purgeAbandonedUploads', () => {
    it('reclaims a ticket that was issued and never used', async () => {
      const issued = await ticket();
      await db()
        .update(fileRecords)
        .set({ createdAt: new Date(Date.now() - 60 * 60_000) })
        .where(eq(fileRecords.id, issued.fileId));
      const purged = await purgeAbandonedUploads(db(), files.uploadTicketTtlMinutes);
      expect(purged).toEqual([issued.fileId]);
      expect(await row(issued.fileId)).toMatchObject({ status: 'TOMBSTONED' });
    });

    it('leaves a ticket inside its window alone', async () => {
      await ticket();
      expect(await purgeAbandonedUploads(db(), files.uploadTicketTtlMinutes)).toEqual([]);
    });

    it('never touches a READY file', async () => {
      const issued = await ticket();
      await applyReconciliation(db(), {
        fileId: issued.fileId,
        maxUploadBytes: files.maxUploadBytes,
        resource: { publicId: 'x', bytes: 10, format: 'pdf', resourceType: 'image' },
      });
      await db()
        .update(fileRecords)
        .set({ createdAt: new Date(Date.now() - 60 * 60_000) })
        .where(eq(fileRecords.id, issued.fileId));
      expect(await purgeAbandonedUploads(db(), files.uploadTicketTtlMinutes)).toEqual([]);
    });
  });
});
