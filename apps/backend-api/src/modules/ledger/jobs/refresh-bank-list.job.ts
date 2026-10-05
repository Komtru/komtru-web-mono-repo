// Keeps the bank list fresh for the bank picker (design §4.4: no request calls a provider).
import type { BankListCache } from '../infrastructure/bankListCache.js';
import type { ProviderRegistry } from '../infrastructure/providerRegistry.js';
import { providerForNewCharge } from '../infrastructure/providerRegistry.js';
import type { Logger } from '../../../platform/logger.js';

export interface RefreshBankListDeps {
  registry: ProviderRegistry;
  cache: BankListCache;
  logger: Logger;
}

/**
 * Fetches the bank list and replaces the cached copy.
 *
 * Throws on a provider failure rather than swallowing it: the scheduler logs the failure and the next
 * occurrence is the retry (the platform scheduler runs each job with `attempts: 1` for exactly this
 * reason). Because the cache is only written on success, a failed run leaves yesterday's list in place,
 * which is what a seller picking their bank needs — a stale list beats an empty one.
 *
 * The list comes from the provider that handles new charges. With one provider that is a tautology;
 * when there are two, this is the decision to revisit rather than quietly unioning two banks lists.
 */
export async function refreshBankList(deps: RefreshBankListDeps): Promise<{ banks: number }> {
  const banks = await deps.registry.getAdapter(providerForNewCharge()).listBanks();
  await deps.cache.write(banks);
  deps.logger.info({ banks: banks.length }, 'ledger: bank list refreshed');
  return { banks: banks.length };
}
