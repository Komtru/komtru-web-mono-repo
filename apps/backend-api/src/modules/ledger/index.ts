// The ledger module's public surface (m8 §2). Other modules reach it only through this file.
//
// Two halves meet here: T-070's chart of accounts, journal and balances — the ledger never transitions
// a trade and never computes a fee, amounts arrive already computed from the trade's snapshot
// (design §6.5) — and T-071's provider layer, the adapter interface, the Paystack implementation,
// the registry and its jobs. Funding, the webhook route and the payouts are T-072 and T-073.
import type { Redis } from 'ioredis';
import type { AppConfig } from '../../config/env.js';
import type { Logger } from '../../platform/logger.js';
import { defineModule, type ModuleContext } from '../../platform/module.js';
import { createRedisBankListCache, type BankListCache } from './infrastructure/bankListCache.js';
import type { ProviderRegistry } from './infrastructure/providerRegistry.js';
import { paymentProviders } from './jobs/providers.js';
import { refreshBankList } from './jobs/refresh-bank-list.job.js';
import {
  resolveAccountNameJob,
  RESOLVE_ACCOUNT_NAME_QUEUE,
  type ResolveAccountNameJob,
} from './jobs/resolve-account-name.job.js';

// The chart of accounts, the posting function and the balance queries (T-070).
export * from './domain/accounts.js';
export * from './domain/journal.js';
export * from './domain/events.js';
export * from './infrastructure/postgres/schema/index.js';
export {
  findAccountId,
  resolveAccountId,
  type Reader,
} from './infrastructure/postgres/accountsRepository.js';
export {
  claimJournalEntry,
  findEntriesByJournal,
  findJournalByKey,
  insertEntries,
  listAccountEntries,
  type JournalEntryClaim,
  type JournalEntryRow,
  type LedgerEntryRow,
} from './infrastructure/postgres/journalRepository.js';
export {
  accountBalance,
  ownerBalances,
  trialBalance,
  type AccountBalance,
  type TrialBalanceRow,
} from './infrastructure/postgres/balancesRepository.js';
export { postJournal, type PostedJournal } from './services/journal.service.js';

// The provider layer (T-071).
export type {
  Bank,
  InitializeChargeInput,
  InitializeChargeResult,
  InitiateRefundInput,
  InitiateRefundResult,
  InitiateTransferInput,
  InitiateTransferResult,
  NormalizedPaymentEvent,
  PaymentProviderAdapter,
  ProviderCode,
  ResolvedAccount,
  TransferRecipientInput,
  TransferRecipientResult,
} from './domain/providerAdapter.js';
export { createProviderRegistry, providerForNewCharge } from './infrastructure/providerRegistry.js';
export { createRedisBankListCache, type BankListCache } from './infrastructure/bankListCache.js';
export { RESOLVE_ACCOUNT_NAME_QUEUE, type ResolveAccountNameJob };

/** 03:15 Africa/Lagos: off-peak, and before the first payout of the working day. */
export const REFRESH_BANK_LIST_CRON = '15 3 * * *';
export const REFRESH_BANK_LIST_SCHEDULE = 'ledger.refresh-bank-list';

interface LedgerDeps {
  registry: ProviderRegistry;
  cache: BankListCache;
  logger: Logger;
}

/**
 * Resolved in `start`, not at import.
 *
 * The platform reads `queues` and `schedules` off a module BEFORE calling `start`, so a handler cannot
 * close over anything the context carries — credentials, the logger, the Redis client. It can only read
 * them when it runs, which is always after `start`. Nothing durable lives here: it is a handle to
 * connections the process already owns.
 */
let deps: LedgerDeps | undefined;

/** Both handlers are async, so this throw reaches the queue as a rejection rather than synchronously. */
const started = (): LedgerDeps => {
  if (!deps) throw new Error('ledger module: a job ran before start() — the module was not started');
  return deps;
};

const buildDeps = (ctx: { config: AppConfig; logger: Logger; redis: Redis }): LedgerDeps => {
  // Without a key every job 503s and every webhook signature returns false, which in the logs looks
  // exactly like an attack. One line at boot is the difference between "misconfigured" and "under
  // attack" for whoever has to read them.
  if (!ctx.config.paystack.secretKey) {
    ctx.logger.warn('ledger: PAYSTACK_SECRET_KEY is not set; every provider call will fail closed');
  }

  return {
    registry: paymentProviders({
      logger: ctx.logger,
      ...(ctx.config.paystack.secretKey ? { secretKey: ctx.config.paystack.secretKey } : {}),
    }),
    cache: createRedisBankListCache(ctx.redis),
    logger: ctx.logger,
  };
};

export const ledgerModule = defineModule({
  name: 'ledger',
  queues: [
    {
      name: RESOLVE_ACCOUNT_NAME_QUEUE,
      process: async (data: ResolveAccountNameJob) => await resolveAccountNameJob(started(), data),
    },
  ],
  schedules: [
    {
      name: REFRESH_BANK_LIST_SCHEDULE,
      cron: REFRESH_BANK_LIST_CRON,
      description: 'Refreshes the cached bank list from the payment provider.',
      handler: async () => await refreshBankList(started()),
    },
  ],
  start: (ctx: ModuleContext) => {
    deps = buildDeps(ctx);
    return Promise.resolve();
  },
  stop: () => {
    deps = undefined;
    return Promise.resolve();
  },
});
