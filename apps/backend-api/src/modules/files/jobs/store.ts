// What the jobs need from persistence, as a port.
//
// The jobs take this rather than a `Db` so each one is testable against a hand-written stub with no
// database at all — which matters here because the question these jobs exist to answer is "what do we
// do with what Cloudinary said", and that has nothing to do with SQL. module.ts binds it to the real
// services in one place (see bindStore).
import type { Db } from '../../../db/index.js';
import type { QuotaThresholds } from '../domain/quota.js';
import type {
  FileRecord,
  StorageAccount,
  StorageAccountStatus,
} from '../infrastructure/postgres/schema/index.js';
import {
  applyReconciliation,
  findFile,
  purgeAbandonedUploads,
  type ReconcileOutcome,
  type ReconcileResource,
} from '../services/file.service.js';
import { applyUsage, findAccountById, listAccounts } from '../services/account.service.js';

export interface FileJobStore {
  findFile(fileId: string): Promise<FileRecord | undefined>;
  findAccountById(id: string): Promise<StorageAccount | undefined>;
  listAccounts(): Promise<StorageAccount[]>;
  applyReconciliation(input: {
    fileId: string;
    maxUploadBytes: number;
    resource: ReconcileResource | undefined;
  }): Promise<ReconcileOutcome>;
  applyUsage(input: {
    account: StorageAccount;
    usage: { storageUsedBytes: number; creditsUsedPct: number };
    thresholds: QuotaThresholds;
  }): Promise<StorageAccountStatus>;
  purgeAbandonedUploads(ttlMinutes: number, now: Date): Promise<string[]>;
}

export const bindStore = (db: Db): FileJobStore => ({
  findFile: (fileId) => findFile(db, fileId),
  findAccountById: (id) => findAccountById(db, id),
  listAccounts: () => listAccounts(db),
  applyReconciliation: (input) => applyReconciliation(db, input),
  applyUsage: (input) => applyUsage(db, input),
  purgeAbandonedUploads: (ttlMinutes, now) => purgeAbandonedUploads(db, ttlMinutes, now),
});
