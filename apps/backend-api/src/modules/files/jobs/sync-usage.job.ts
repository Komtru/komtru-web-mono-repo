// M20 §5's hourly usage sweep, and the only writer of storage_accounts.status.
//
// Flips status BEFORE an account actually fails a real upload, not after — which is the entire point
// of polling a usage endpoint rather than reacting to errors. Application code never flips an account
// to DISABLED because an upload failed: a single transient 500 would take it out of rotation for a
// reason that had nothing to do with quota, and three in a row would take the whole pool down.
import { isAccountConfigured } from '../infrastructure/credentials.js';
import type { StorageAccountStatus } from '../infrastructure/postgres/schema/index.js';
import type { FileJobDeps } from './deps.js';

export interface UsageSyncResult {
  synced: number;
  failed: number;
  transitions: { label: string; from: StorageAccountStatus; to: StorageAccountStatus }[];
}

export async function runSyncUsage(deps: FileJobDeps): Promise<UsageSyncResult> {
  const accounts = await deps.store.listAccounts();
  const result: UsageSyncResult = { synced: 0, failed: 0, transitions: [] };

  for (const account of accounts) {
    if (!isAccountConfigured(deps.files, account.credentialEnvPrefix)) {
      deps.logger.warn(
        { label: account.label },
        'files: skipping usage sync — account has no credentials in this environment',
      );
      result.failed += 1;
      continue;
    }

    try {
      const usage = await deps.storage.fetchUsage(account.credentialEnvPrefix);
      const next = await deps.store.applyUsage({ account, usage, thresholds: deps.files.quota });
      result.synced += 1;

      if (next !== account.status) {
        result.transitions.push({ label: account.label, from: account.status, to: next });
        announce(deps, account.label, next, usage.creditsUsedPct);
      }
    } catch (error) {
      // Deliberately leaves `status` alone. A failed poll says nothing about the account's quota, and
      // guessing here would take a healthy account out of rotation because of a network blip. One
      // account's failure never stops the sweep: five accounts are polled independently.
      deps.logger.error({ err: error, label: account.label }, 'files: usage sync failed for one account');
      result.failed += 1;
    }
  }

  return result;
}

/** The ops events are published by applyUsage, inside the same transaction as the status change. */
const announce = (
  deps: FileJobDeps,
  label: string,
  next: StorageAccountStatus,
  creditsUsedPct: number,
): void => {
  const fields = { label, creditsUsedPct };
  if (next === 'NEAR_QUOTA') {
    deps.logger.warn(fields, 'files: storage account is near its quota');
    return;
  }
  if (next === 'DISABLED') {
    deps.logger.error(fields, 'files: storage account disabled — provision a replacement');
    return;
  }
  deps.logger.info(fields, 'files: storage account recovered to ACTIVE');
};
