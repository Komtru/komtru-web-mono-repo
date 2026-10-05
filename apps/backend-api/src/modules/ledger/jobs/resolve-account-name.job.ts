// Bank-name resolution, as a job (design §4.4: "create a pending record, run in a job, push the result
// over the socket"). The caller never waits on the provider.
import type { Logger } from '../../../platform/logger.js';
import type { ProviderCode, ResolvedAccount } from '../domain/providerAdapter.js';
import type { ProviderRegistry } from '../infrastructure/providerRegistry.js';

export const RESOLVE_ACCOUNT_NAME_QUEUE = 'ledger.resolve-account-name';

export interface ResolveAccountNameJob {
  accountNumber: string;
  bankCode: string;
  /** Pinned by the caller, so a retry a day later resolves against the provider it was queued for. */
  provider: ProviderCode;
}

export interface ResolveAccountNameDeps {
  registry: ProviderRegistry;
  logger: Logger;
}

/**
 * Resolves the account holder's name. The result is the job's return value, which BullMQ keeps against
 * the job id; T-073 adds the `payout_accounts` write and T-051 the socket push that tells the browser.
 *
 * Nothing here logs the account number: providerRequest redacts it out of the URL, and repeating it in
 * a log line of our own would put it back.
 */
export async function resolveAccountNameJob(
  deps: ResolveAccountNameDeps,
  data: ResolveAccountNameJob,
): Promise<ResolvedAccount> {
  const adapter = deps.registry.getAdapter(data.provider);
  const resolved = await adapter.resolveAccountName(data.accountNumber, data.bankCode);
  deps.logger.info({ provider: data.provider, bankCode: data.bankCode }, 'ledger: account name resolved');
  return resolved;
}
