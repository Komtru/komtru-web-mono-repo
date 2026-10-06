// Retrieval and the access control on it (M20 §6, D2, D3). The decision itself is a pure function
// tested in domain/access.test.ts; what is tested here is everything around it — loading the grants,
// logging the outcome for the sensitive categories, and turning an allow into a signed URL.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { FilesConfig } from '../../../../src/config/env.js';
import { createDb, type Db } from '../../../../src/db/index.js';
import { outbox } from '../../../../src/db/platform-schema.js';
import { ApiError } from '../../../../src/platform/errors.js';
import { createLogger } from '../../../../src/platform/logger.js';
import type { AccessSubject } from '../../../../src/modules/files/domain/access.js';
import {
  grantAccess,
  listAccessLog,
  listGrants,
  retrieveFile,
  revokeGrant,
  subjectFrom,
} from '../../../../src/modules/files/services/access.service.js';
import { seedStorageAccounts } from '../../../../src/modules/files/services/account.service.js';
import {
  applyReconciliation,
  createUploadTicket,
  requestTombstone,
} from '../../../../src/modules/files/services/file.service.js';
import { testPrincipal } from '../../../support/actors.js';
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

const consumer = (userId: string): AccessSubject => ({ userId, scope: 'CONSUMER', roles: [] });
const staff = (userId: string, roles: string[] = []): AccessSubject => ({ userId, scope: 'STAFF', roles });

describe.runIf(infraEnabled)('access.service', () => {
  const t = useTestDatabase();
  const db = (): Db => createDb(t.app());

  /** A READY file of the given category, uploaded by `uploaderUserId`. */
  const readyFile = async (input: {
    category: Parameters<typeof createUploadTicket>[2]['category'];
    visibility: Parameters<typeof createUploadTicket>[2]['visibility'];
    uploaderUserId?: string;
    contentType?: string;
  }) => {
    await seedStorageAccounts(db(), files, logger);
    const uploaderUserId = input.uploaderUserId ?? randomUUID();
    const contentType = input.contentType ?? 'image/jpeg';
    const issued = await createUploadTicket(
      db(),
      { files },
      {
        uploaderUserId,
        category: input.category,
        visibility: input.visibility,
        contentType,
      },
    );
    await applyReconciliation(db(), {
      fileId: issued.fileId,
      maxUploadBytes: files.maxUploadBytes,
      resource: { publicId: 'x', bytes: 2048, format: 'jpg', resourceType: 'image' },
    });
    return { fileId: issued.fileId, uploaderUserId };
  };

  const retrieve = (fileId: string, subject: AccessSubject) =>
    retrieveFile(db(), { files, logger }, { fileId, subject });

  const logRows = (fileId: string) => listAccessLog(db(), fileId, { limit: 50 });

  describe('grants', () => {
    it('is idempotent on a repeated grant', async () => {
      // `dispute.opened` is at-least-once by contract (M20 §8), so the same grant WILL be requested
      // twice, and a duplicate-key 500 on the second delivery would leave a dispute half-wired.
      const { fileId } = await readyFile({ category: 'DISPUTE_EVIDENCE', visibility: 'PRIVATE_CASE' });
      const granteeUserId = randomUUID();
      const first = await grantAccess(db(), { fileId, granteeUserId, reason: 'party to the dispute' });
      const second = await grantAccess(db(), { fileId, granteeUserId, reason: 'party to the dispute' });
      expect(second.id).toBe(first.id);
      expect(await listGrants(db(), fileId)).toHaveLength(1);
    });

    it('is idempotent under two deliveries racing, which is the case it exists for', async () => {
      // The sequential test above cannot fail the way this function used to: a read-then-insert
      // loses exactly when both callers miss the select, and `dispute.opened` is at-least-once by
      // contract, so that is the ordinary case rather than the exotic one. Without
      // ON CONFLICT DO NOTHING the loser raises 23505 as a raw 500.
      const { fileId } = await readyFile({ category: 'DISPUTE_EVIDENCE', visibility: 'PRIVATE_CASE' });
      const granteeUserId = randomUUID();
      const input = { fileId, granteeUserId, reason: 'party to the dispute' };

      const [first, second] = await Promise.all([grantAccess(db(), input), grantAccess(db(), input)]);

      expect(first.id).toBe(second.id);
      expect(await listGrants(db(), fileId)).toHaveLength(1);
      const published = (await db().select().from(outbox)).filter(
        (event) => event.eventType === 'files.file.access_granted',
      );
      // One grant is one event, however many deliveries raced for it.
      expect(published).toHaveLength(1);
    });

    it('is idempotent on a racing role grant too', async () => {
      const { fileId } = await readyFile({ category: 'DISPUTE_EVIDENCE', visibility: 'PRIVATE_CASE' });
      const input = { fileId, granteeRole: 'DISPUTE_REVIEWER', reason: 'assigned reviewer' };
      const [first, second] = await Promise.all([grantAccess(db(), input), grantAccess(db(), input)]);
      expect(first.id).toBe(second.id);
      expect(await listGrants(db(), fileId)).toHaveLength(1);
    });

    it('publishes files.file.access_granted once', async () => {
      const { fileId } = await readyFile({ category: 'DISPUTE_EVIDENCE', visibility: 'PRIVATE_CASE' });
      const granteeUserId = randomUUID();
      await grantAccess(db(), { fileId, granteeUserId, reason: 'party' });
      await grantAccess(db(), { fileId, granteeUserId, reason: 'party' });
      const published = (await db().select().from(outbox)).filter(
        (event) => event.eventType === 'files.file.access_granted',
      );
      expect(published).toHaveLength(1);
    });

    it('refuses a grant naming both a user and a role, and one naming neither', async () => {
      const { fileId } = await readyFile({ category: 'DISPUTE_EVIDENCE', visibility: 'PRIVATE_CASE' });
      await expect(
        grantAccess(db(), {
          fileId,
          granteeUserId: randomUUID(),
          granteeRole: 'DISPUTE_REVIEWER',
          reason: 'x',
        }),
      ).rejects.toBeInstanceOf(ApiError);
      await expect(grantAccess(db(), { fileId, reason: 'x' })).rejects.toBeInstanceOf(ApiError);
    });

    it('refuses a grant on a class where it would be inert', async () => {
      // decideAccess only consults grants for PRIVATE_CASE, so accepting one elsewhere would let an
      // operator believe they had shared a file when they had not.
      const { fileId } = await readyFile({
        category: 'KYC_DOCUMENT',
        visibility: 'PRIVATE_OWNER',
        contentType: 'application/pdf',
      });
      await expect(
        grantAccess(db(), { fileId, granteeUserId: randomUUID(), reason: 'x' }),
      ).rejects.toMatchObject({
        status: 409,
      });
    });

    it('stops admitting a revoked grantee', async () => {
      const { fileId } = await readyFile({ category: 'DISPUTE_EVIDENCE', visibility: 'PRIVATE_CASE' });
      const granteeUserId = randomUUID();
      const grant = await grantAccess(db(), { fileId, granteeUserId, reason: 'party' });
      await expect(retrieve(fileId, consumer(granteeUserId))).resolves.toBeTruthy();
      expect(await revokeGrant(db(), fileId, grant.id)).toBe(true);
      await expect(retrieve(fileId, consumer(granteeUserId))).rejects.toMatchObject({ status: 404 });
    });

    it('re-grants after a revoke rather than resurrecting the old row', async () => {
      const { fileId } = await readyFile({ category: 'DISPUTE_EVIDENCE', visibility: 'PRIVATE_CASE' });
      const granteeUserId = randomUUID();
      const first = await grantAccess(db(), { fileId, granteeUserId, reason: 'party' });
      await revokeGrant(db(), fileId, first.id);
      const second = await grantAccess(db(), { fileId, granteeUserId, reason: 'party again' });
      expect(second.id).not.toBe(first.id);
    });
  });

  describe('retrieval', () => {
    it('serves a PUBLIC file with a non-expiring signed delivery URL', async () => {
      const { fileId } = await readyFile({ category: 'LISTING_IMAGE', visibility: 'PUBLIC' });
      const result = await retrieve(fileId, consumer(randomUUID()));
      expect(result.url).toContain('res.cloudinary.com');
      expect(result.url).toContain('/authenticated/s--');
      // Stated rather than omitted, so a client can tell "does not expire" from "expiry unknown".
      expect(result.expiresAt).toBeNull();
    });

    it('serves a restricted file with a URL that genuinely expires', async () => {
      const { fileId, uploaderUserId } = await readyFile({
        category: 'KYC_DOCUMENT',
        visibility: 'PRIVATE_OWNER',
        contentType: 'application/pdf',
      });
      const result = await retrieve(fileId, consumer(uploaderUserId));
      expect(result.url).toContain('api.cloudinary.com');
      expect(result.url).toContain('expires_at=');
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(result.expiresAt!.getTime() - Date.now()).toBeLessThanOrEqual(
        files.signedUrlTtlSeconds * 1000 + 5_000,
      );
    });

    it('never returns the storage object id or the cloud name', async () => {
      // D1: a consumer passes a category and never learns which of the five accounts holds the bytes.
      const { fileId } = await readyFile({ category: 'LISTING_IMAGE', visibility: 'PUBLIC' });
      const result = await retrieve(fileId, consumer(randomUUID()));
      expect(Object.keys(result).sort()).toEqual([
        'category',
        'contentType',
        'expiresAt',
        'fileId',
        'sizeBytes',
        'url',
      ]);
    });

    it('gives the same 404 for a file that does not exist and one the caller may not have', async () => {
      const { fileId } = await readyFile({
        category: 'KYC_DOCUMENT',
        visibility: 'PRIVATE_OWNER',
        contentType: 'application/pdf',
      });
      const refusal = (promise: Promise<unknown>): Promise<ApiError> =>
        promise.then(
          () => {
            throw new Error('expected a refusal');
          },
          (error: unknown) => error as ApiError,
        );
      const refused = await refusal(retrieve(fileId, consumer(randomUUID())));
      const missing = await refusal(retrieve(randomUUID(), consumer(randomUUID())));
      expect(refused.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(refused.title).toBe(missing.title);
      expect(refused.code).toBe(missing.code);
    });

    it('answers 410 for a tombstoned file, the one refusal allowed to be specific', async () => {
      const { fileId, uploaderUserId } = await readyFile({ category: 'LISTING_IMAGE', visibility: 'PUBLIC' });
      await requestTombstone(db(), { fileId, reason: 'retention' });
      await expect(retrieve(fileId, consumer(uploaderUserId))).rejects.toMatchObject({
        status: 410,
        code: 'FILE_TOMBSTONED',
      });
    });

    it('checks access before completeness, so a stranger learns nothing about the upload', async () => {
      // Answering "this id exists and is still uploading" to an unauthorised caller is the existence
      // oracle again, by another route.
      await seedStorageAccounts(db(), files, logger);
      const issued = await createUploadTicket(
        db(),
        { files },
        {
          uploaderUserId: randomUUID(),
          category: 'KYC_DOCUMENT',
          visibility: 'PRIVATE_OWNER',
          contentType: 'application/pdf',
        },
      );
      await expect(retrieve(issued.fileId, consumer(randomUUID()))).rejects.toMatchObject({ status: 404 });
    });

    it('tells the uploader their own upload has not completed', async () => {
      await seedStorageAccounts(db(), files, logger);
      const uploaderUserId = randomUUID();
      const issued = await createUploadTicket(
        db(),
        { files },
        {
          uploaderUserId,
          category: 'KYC_DOCUMENT',
          visibility: 'PRIVATE_OWNER',
          contentType: 'application/pdf',
        },
      );
      await expect(retrieve(issued.fileId, consumer(uploaderUserId))).rejects.toMatchObject({ status: 409 });
    });

    it('admits a staff role grantee on a PRIVATE_CASE file', async () => {
      const { fileId } = await readyFile({ category: 'DISPUTE_EVIDENCE', visibility: 'PRIVATE_CASE' });
      await grantAccess(db(), { fileId, granteeRole: 'DISPUTE_REVIEWER', reason: 'assigned reviewer' });
      await expect(retrieve(fileId, staff(randomUUID(), ['DISPUTE_REVIEWER']))).resolves.toBeTruthy();
      await expect(retrieve(fileId, staff(randomUUID(), ['SUPPORT_AGENT']))).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('access log', () => {
    it('records every decision for the three audited categories, refusals included', async () => {
      // A pattern of refused reads against KYC documents is the thing an investigation is looking
      // for, and a log that records only successes cannot show it.
      for (const category of ['KYC_DOCUMENT', 'DISPUTE_EVIDENCE', 'CUSTODY_EVIDENCE'] as const) {
        const visibility = category === 'KYC_DOCUMENT' ? 'PRIVATE_OWNER' : 'PRIVATE_CASE';
        const { fileId, uploaderUserId } = await readyFile({ category, visibility });
        await retrieve(fileId, consumer(uploaderUserId));
        await retrieve(fileId, consumer(randomUUID())).catch(() => undefined);
        const rows = await logRows(fileId);
        expect(rows.map((row) => row.accessGranted)).toEqual(expect.arrayContaining([true, false]));
        expect(rows.find((row) => !row.accessGranted)?.deniedReason).toBeTruthy();
      }
    });

    it('records nothing for a listing image', async () => {
      const { fileId } = await readyFile({ category: 'LISTING_IMAGE', visibility: 'PUBLIC' });
      await retrieve(fileId, consumer(randomUUID()));
      expect(await logRows(fileId)).toHaveLength(0);
    });

    it('separates the staff actor from the consumer actor', async () => {
      const { fileId } = await readyFile({ category: 'DISPUTE_EVIDENCE', visibility: 'PRIVATE_CASE' });
      const adminId = randomUUID();
      await retrieve(fileId, staff(adminId)).catch(() => undefined);
      const [row] = await logRows(fileId);
      expect(row).toMatchObject({ accessedByAdminId: adminId, accessedByUserId: null });
    });

    it('does not fail the read when the log write fails', async () => {
      // A failed audit write must not fail the read it was auditing — but it must not pass silently
      // either, so it logs at error. Drive it by taking the INSERT grant away from the runtime role.
      const { fileId, uploaderUserId } = await readyFile({
        category: 'KYC_DOCUMENT',
        visibility: 'PRIVATE_OWNER',
        contentType: 'application/pdf',
      });
      await t.owner().query('REVOKE INSERT ON files.file_access_log FROM komtru_app');
      try {
        await expect(retrieve(fileId, consumer(uploaderUserId))).resolves.toBeTruthy();
      } finally {
        await t.owner().query('GRANT INSERT ON files.file_access_log TO komtru_app');
      }
    });
  });

  describe('subjectFrom', () => {
    it('builds the subject from a resolved principal, never from an actor key', () => {
      const userId = randomUUID();
      const principal = testPrincipal(userId, { scope: 'STAFF', roles: ['DISPUTE_REVIEWER'] });
      expect(subjectFrom(principal)).toEqual({ userId, scope: 'STAFF', roles: ['DISPUTE_REVIEWER'] });
    });
  });
});
