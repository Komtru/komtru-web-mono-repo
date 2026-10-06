// The four jobs, against a hand-written CloudinaryClient and a hand-written persistence port. Neither
// a network nor a database is needed to answer the questions that matter here: what the job does with
// what Cloudinary said, and what it does when Cloudinary says nothing.
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../../../src/platform/logger.js';
import type { FilesConfig } from '../../../../src/config/env.js';
import type { CloudinaryClient } from '../../../../src/modules/files/infrastructure/providers/cloudinary.client.js';
import { runDestroyAsset } from '../../../../src/modules/files/jobs/destroy-asset.job.js';
import { runFinalizeUpload } from '../../../../src/modules/files/jobs/finalize-upload.job.js';
import { runPurgeAbandoned } from '../../../../src/modules/files/jobs/purge-abandoned.job.js';
import { runSyncUsage } from '../../../../src/modules/files/jobs/sync-usage.job.js';
import type { FileJobStore } from '../../../../src/modules/files/jobs/store.js';
import type {
  FileRecord,
  StorageAccount,
} from '../../../../src/modules/files/infrastructure/postgres/schema/index.js';

const logger = createLogger({ log: { level: 'silent', format: 'json' } } as never);

const files: FilesConfig = {
  accounts: {
    CLOUDINARY_TRADE_1: { cloudName: 'c1', apiKey: '1', apiSecret: 'not-a-real-secret' },
    CLOUDINARY_TRADE_2: { cloudName: 'c2', apiKey: '2', apiSecret: 'not-a-real-secret' },
  },
  maxUploadBytes: 1_000_000,
  uploadTicketTtlMinutes: 30,
  signedUrlTtlSeconds: 300,
  quota: { nearPct: 85, disabledPct: 97 },
};

const account = (overrides: Partial<StorageAccount> = {}): StorageAccount => ({
  id: randomUUID(),
  pool: 'TRADE_ASSET',
  label: 'trade-1',
  cloudName: 'c1',
  credentialEnvPrefix: 'CLOUDINARY_TRADE_1',
  status: 'ACTIVE',
  rotationOrder: 1,
  storageUsedBytes: 0,
  creditsUsedPct: '0',
  lastUsageSyncedAt: null,
  createdAt: new Date(),
  ...overrides,
});

const record = (overrides: Partial<FileRecord> = {}): FileRecord => ({
  id: randomUUID(),
  uploaderUserId: randomUUID(),
  owningModule: 'trust',
  category: 'KYC_DOCUMENT',
  visibility: 'PRIVATE_OWNER',
  storageAccountId: randomUUID(),
  storageObjectId: 'abc',
  contentType: 'application/pdf',
  sizeBytes: 0,
  uploadState: 'RECONCILING',
  finalizedAt: null,
  status: 'ACTIVE',
  captureReceivedAt: null,
  captureHubId: null,
  createdAt: new Date(),
  tombstonedAt: null,
  tombstonedReason: null,
  ...overrides,
});

const stubClient = (overrides: Partial<CloudinaryClient> = {}): CloudinaryClient => ({
  fetchUsage: () => Promise.resolve({ storageUsedBytes: 0, creditsUsedPct: 0 }),
  fetchResource: () => Promise.resolve(undefined),
  destroyAsset: () => Promise.resolve(true),
  ...overrides,
});

const stubStore = (overrides: Partial<FileJobStore> = {}): FileJobStore => ({
  findFile: () => Promise.resolve(undefined),
  findAccountById: () => Promise.resolve(undefined),
  listAccounts: () => Promise.resolve([]),
  applyReconciliation: () => Promise.resolve({ outcome: 'MISSING' }),
  applyUsage: () => Promise.resolve('ACTIVE'),
  purgeAbandonedUploads: () => Promise.resolve([]),
  ...overrides,
});

const deps = (store: FileJobStore, storage: CloudinaryClient) => ({ store, storage, files, logger });

describe('runFinalizeUpload', () => {
  it('throws when Cloudinary has no asset yet, so BullMQ retries rather than abandoning the file', async () => {
    // The client may still be uploading a 15MB photo. Returning quietly here would leave the row
    // RECONCILING until the once-every-hour sweep tombstones it.
    const file = record();
    const store = stubStore({
      findFile: () => Promise.resolve(file),
      findAccountById: () => Promise.resolve(account()),
      applyReconciliation: () => Promise.resolve({ outcome: 'MISSING' }),
    });
    await expect(runFinalizeUpload(deps(store, stubClient()), { fileId: file.id })).rejects.toThrow(
      /no upload has landed/i,
    );
  });

  it('reconciles with what Cloudinary reports', async () => {
    const file = record();
    const resource = { publicId: 'abc', bytes: 4096, format: 'pdf', resourceType: 'image' };
    const applyReconciliation = vi.fn(() => Promise.resolve({ outcome: 'READY' as const, record: file }));
    const store = stubStore({
      findFile: () => Promise.resolve(file),
      findAccountById: () => Promise.resolve(account()),
      applyReconciliation,
    });
    const outcome = await runFinalizeUpload(
      deps(store, stubClient({ fetchResource: () => Promise.resolve(resource) })),
      { fileId: file.id },
    );
    expect(outcome.outcome).toBe('READY');
    expect(applyReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: file.id, resource, maxUploadBytes: files.maxUploadBytes }),
    );
  });

  it('returns without a Cloudinary call for a file that is already READY', async () => {
    const fetchResource = vi.fn(() => Promise.resolve(undefined));
    const file = record({ uploadState: 'READY' });
    const store = stubStore({ findFile: () => Promise.resolve(file) });
    await expect(
      runFinalizeUpload(deps(store, stubClient({ fetchResource })), { fileId: file.id }),
    ).resolves.toMatchObject({ outcome: 'READY' });
    expect(fetchResource).not.toHaveBeenCalled();
  });

  it('gives up permanently on a file that no longer exists', async () => {
    // Deterministic: retrying it five times only delays the dead-letter and its alert.
    await expect(
      runFinalizeUpload(deps(stubStore(), stubClient()), { fileId: randomUUID() }),
    ).rejects.toMatchObject({ name: 'UnrecoverableError' });
  });

  it('gives up permanently on a tombstoned file', async () => {
    const file = record({ status: 'TOMBSTONED', tombstonedReason: 'retention' });
    const store = stubStore({ findFile: () => Promise.resolve(file) });
    await expect(runFinalizeUpload(deps(store, stubClient()), { fileId: file.id })).rejects.toMatchObject({
      name: 'UnrecoverableError',
    });
  });
});

describe('runDestroyAsset', () => {
  it('destroys the asset for a tombstoned file', async () => {
    const file = record({ status: 'TOMBSTONED', tombstonedReason: 'retention' });
    const destroyAsset = vi.fn(() => Promise.resolve(true));
    const store = stubStore({
      findFile: () => Promise.resolve(file),
      findAccountById: () => Promise.resolve(account()),
    });
    await expect(
      runDestroyAsset(deps(store, stubClient({ destroyAsset })), { fileId: file.id }),
    ).resolves.toEqual({ destroyed: true });
    expect(destroyAsset).toHaveBeenCalledWith({
      prefix: 'CLOUDINARY_TRADE_1',
      publicId: 'abc',
      resourceType: 'image',
    });
  });

  it('tolerates a provider failure without throwing', async () => {
    // The tombstone is the durable half and has already landed. A failure here is an orphaned asset
    // for an operator to reconcile, not a reason to retry forever.
    const file = record({ status: 'TOMBSTONED', tombstonedReason: 'retention' });
    const store = stubStore({
      findFile: () => Promise.resolve(file),
      findAccountById: () => Promise.resolve(account()),
    });
    await expect(
      runDestroyAsset(deps(store, stubClient({ destroyAsset: () => Promise.resolve(false) })), {
        fileId: file.id,
      }),
    ).resolves.toEqual({ destroyed: false });
  });

  it('refuses to destroy an asset whose row is not tombstoned', async () => {
    // BullMQ keeps a failed job for 30 days. A replayed destroy must not delete bytes that a later
    // operator reinstated, or that were never meant to go.
    const destroyAsset = vi.fn(() => Promise.resolve(true));
    const file = record({ status: 'ACTIVE' });
    const store = stubStore({
      findFile: () => Promise.resolve(file),
      findAccountById: () => Promise.resolve(account()),
    });
    await expect(
      runDestroyAsset(deps(store, stubClient({ destroyAsset })), { fileId: file.id }),
    ).rejects.toMatchObject({ name: 'UnrecoverableError' });
    expect(destroyAsset).not.toHaveBeenCalled();
  });
});

describe('runSyncUsage', () => {
  const accounts = [
    account({ label: 'trade-1', credentialEnvPrefix: 'CLOUDINARY_TRADE_1' }),
    account({ label: 'trade-2', credentialEnvPrefix: 'CLOUDINARY_TRADE_2' }),
  ];

  it('polls every account independently: one failure does not stop the sweep', async () => {
    // Five accounts polled separately, and a Cloudinary outage on one must not leave the other four
    // un-synced.
    const fetchUsage = vi.fn((prefix: string) =>
      prefix === 'CLOUDINARY_TRADE_1'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ storageUsedBytes: 1, creditsUsedPct: 10 }),
    );
    const store = stubStore({ listAccounts: () => Promise.resolve(accounts) });
    const result = await runSyncUsage(deps(store, stubClient({ fetchUsage })));
    expect(result).toMatchObject({ synced: 1, failed: 1 });
  });

  it('leaves status alone when a poll fails', async () => {
    // A failed poll says nothing about the account's quota, and guessing would take a healthy
    // account out of rotation because of a network blip.
    const applyUsage = vi.fn(() => Promise.resolve('ACTIVE' as const));
    const store = stubStore({ listAccounts: () => Promise.resolve([accounts[0]!]), applyUsage });
    await runSyncUsage(deps(store, stubClient({ fetchUsage: () => Promise.reject(new Error('boom')) })));
    expect(applyUsage).not.toHaveBeenCalled();
  });

  it('reports the transitions it made', async () => {
    const store = stubStore({
      listAccounts: () => Promise.resolve([accounts[0]!]),
      applyUsage: () => Promise.resolve('NEAR_QUOTA'),
    });
    const result = await runSyncUsage(
      deps(
        store,
        stubClient({ fetchUsage: () => Promise.resolve({ storageUsedBytes: 1, creditsUsedPct: 90 }) }),
      ),
    );
    expect(result.transitions).toEqual([{ label: 'trade-1', from: 'ACTIVE', to: 'NEAR_QUOTA' }]);
  });

  it('reports no transition when the status is unchanged', async () => {
    const store = stubStore({
      listAccounts: () => Promise.resolve([accounts[0]!]),
      applyUsage: () => Promise.resolve('ACTIVE'),
    });
    const result = await runSyncUsage(deps(store, stubClient()));
    expect(result.transitions).toEqual([]);
  });

  it('skips an account with no credentials here and makes no provider call for it', async () => {
    const fetchUsage = vi.fn(() => Promise.resolve({ storageUsedBytes: 1, creditsUsedPct: 1 }));
    const unconfigured = account({ label: 'trade-9', credentialEnvPrefix: 'CLOUDINARY_TRADE_9' });
    const store = stubStore({ listAccounts: () => Promise.resolve([unconfigured]) });
    const result = await runSyncUsage(deps(store, stubClient({ fetchUsage })));
    expect(result).toMatchObject({ synced: 0, failed: 1 });
    expect(fetchUsage).not.toHaveBeenCalled();
  });
});

describe('runPurgeAbandoned', () => {
  it('measures the cutoff from the occurrence’s scheduled time, not from now', async () => {
    // The scheduler hands the handler the time the occurrence was due, so a late run computes the
    // same cutoff it would have computed on time.
    const purgeAbandonedUploads = vi.fn(() => Promise.resolve([randomUUID()]));
    const firedAt = new Date('2026-10-06T09:00:00Z');
    const store = stubStore({ purgeAbandonedUploads });
    await expect(runPurgeAbandoned(deps(store, stubClient()), firedAt)).resolves.toEqual({ purged: 1 });
    expect(purgeAbandonedUploads).toHaveBeenCalledWith(files.uploadTicketTtlMinutes, firedAt);
  });

  it('reports zero without complaint when there is nothing to reclaim', async () => {
    await expect(runPurgeAbandoned(deps(stubStore(), stubClient()), new Date())).resolves.toEqual({
      purged: 0,
    });
  });
});
