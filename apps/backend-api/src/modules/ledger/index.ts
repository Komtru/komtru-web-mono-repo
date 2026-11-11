// The ledger module's public surface (m8 §2). Other modules reach it only through this file.
//
// Two halves meet here: T-070's chart of accounts, journal and balances — the ledger never transitions
// a trade and never computes a fee, amounts arrive already computed from the trade's snapshot
// (design §6.5) — and T-071's provider layer, the adapter interface, the Paystack implementation,
// the registry and its jobs. Funding, the webhook route and the payouts are T-072 and T-073.
import { UnrecoverableError } from 'bullmq';
import type { Redis } from 'ioredis';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/index.js';
import type { QueueFactory } from '../../platform/queue/factory.js';
import type { Logger } from '../../platform/logger.js';
import { defineModule, type ModuleContext } from '../../platform/module.js';
import { tradeStateChangedEvent } from '../trades/index.js';
import { IdempotencyKeyConflictError } from './domain/journal.js';
import { createRedisBankListCache, type BankListCache } from './infrastructure/bankListCache.js';
import type { ProviderRegistry } from './infrastructure/providerRegistry.js';
import { paymentRoutes } from './http/routes.js';
import { releaseEscrow } from './services/release.service.js';
import { webhookRoutes } from './http/webhookRoutes.js';
import type { VerifiedChargeView } from './domain/funding.js';
import {
  enqueuePaymentWebhook,
  enqueueVerifyCharge,
  PROCESS_PAYMENT_WEBHOOK_QUEUE,
  processPaymentWebhookJob,
  sweepPaymentWebhooks,
  VERIFY_CHARGE_QUEUE,
  verifyChargeJob,
  FUNDING_JOB_ATTEMPTS,
  FUNDING_JOB_BACKOFF_MS,
  type ProcessPaymentWebhookJob,
  type VerifyChargeJob,
} from './jobs/funding.job.js';
import { chargeVerifier, paymentProviders } from './jobs/providers.js';
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
export * from './domain/funding.js';
export * from './domain/release.js';
export * from './domain/payouts.js';
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
export {
  releaseEscrow,
  RELEASABLE_STATUSES,
  type ReleaseDeps,
  type ReleaseInput,
  type ReleaseResult,
} from './services/release.service.js';
export {
  activeTradeHolds,
  lockTradeForRelease,
  type TradeForRelease,
} from './infrastructure/postgres/tradeRelease.js';

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
export { paystackEventId } from './infrastructure/providers/paystack/eventId.js';
export { createProviderRegistry, providerForNewCharge } from './infrastructure/providerRegistry.js';
export { createRedisBankListCache, type BankListCache } from './infrastructure/bankListCache.js';
export { RESOLVE_ACCOUNT_NAME_QUEUE, type ResolveAccountNameJob };

// Funding a trade (T-072).
export { PROCESS_PAYMENT_WEBHOOK_QUEUE, VERIFY_CHARGE_QUEUE };

/** Every five minutes: re-queues signed deliveries whose first enqueue never ran. */
export const SWEEP_PAYMENT_WEBHOOKS_CRON = '*/5 * * * *';
export const SWEEP_PAYMENT_WEBHOOKS_SCHEDULE = 'ledger.sweep-payment-webhooks';

/** 03:15 Africa/Lagos: off-peak, and before the first payout of the working day. */
export const REFRESH_BANK_LIST_CRON = '15 3 * * *';
export const REFRESH_BANK_LIST_SCHEDULE = 'ledger.refresh-bank-list';

interface LedgerDeps {
  registry: ProviderRegistry;
  cache: BankListCache;
  logger: Logger;
  db: Db;
  queues: QueueFactory;
  publicKey: string | undefined;
  verify: (reference: string) => Promise<VerifiedChargeView>;
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

const buildDeps = (ctx: {
  config: AppConfig;
  logger: Logger;
  redis: Redis;
  db: Db;
  queues: QueueFactory;
}): LedgerDeps => {
  // Without a key every job 503s and every webhook signature returns false, which in the logs looks
  // exactly like an attack. One line at boot is the difference between "misconfigured" and "under
  // attack" for whoever has to read them.
  if (!ctx.config.paystack.secretKey) {
    ctx.logger.warn('ledger: PAYSTACK_SECRET_KEY is not set; every provider call will fail closed');
  }

  const paystack = {
    logger: ctx.logger,
    ...(ctx.config.paystack.secretKey ? { secretKey: ctx.config.paystack.secretKey } : {}),
  };
  return {
    registry: paymentProviders(paystack),
    cache: createRedisBankListCache(ctx.redis),
    logger: ctx.logger,
    db: ctx.db,
    queues: ctx.queues,
    publicKey: ctx.config.paystack.publicKey,
    verify: chargeVerifier(paystack),
  };
};

const fundingJobDeps = () => {
  const d = started();
  const adapter = d.registry.getAdapter('PAYSTACK');
  return {
    db: d.db,
    logger: d.logger,
    verify: d.verify,
    parse: (rawBody: Buffer) => adapter.parseWebhookEvent(rawBody),
  };
};

export const ledgerModule = defineModule({
  name: 'ledger',
  routes: [
    ...paymentRoutes(() => {
      const d = started();
      return {
        db: d.db,
        publicKey: d.publicKey,
        logger: d.logger,
        enqueueVerify: (reference) => enqueueVerifyCharge(d.queues, reference),
      };
    }),
    ...webhookRoutes(() => {
      const d = started();
      return {
        db: d.db,
        adapter: d.registry.getAdapter('PAYSTACK'),
        logger: d.logger,
        enqueueDelivery: (webhookId) => enqueuePaymentWebhook(d.queues, webhookId),
      };
    }),
  ],
  queues: [
    {
      name: RESOLVE_ACCOUNT_NAME_QUEUE,
      process: async (data: ResolveAccountNameJob) => await resolveAccountNameJob(started(), data),
    },
    {
      name: VERIFY_CHARGE_QUEUE,
      attempts: FUNDING_JOB_ATTEMPTS,
      backoffMs: FUNDING_JOB_BACKOFF_MS,
      process: async (data: VerifyChargeJob) => await verifyChargeJob(fundingJobDeps(), data),
    },
    {
      name: PROCESS_PAYMENT_WEBHOOK_QUEUE,
      attempts: FUNDING_JOB_ATTEMPTS,
      backoffMs: FUNDING_JOB_BACKOFF_MS,
      process: async (data: ProcessPaymentWebhookJob) =>
        await processPaymentWebhookJob(fundingJobDeps(), data),
    },
  ],
  schedules: [
    {
      name: REFRESH_BANK_LIST_SCHEDULE,
      cron: REFRESH_BANK_LIST_CRON,
      description: 'Refreshes the cached bank list from the payment provider.',
      handler: async () => await refreshBankList(started()),
    },
    {
      name: SWEEP_PAYMENT_WEBHOOKS_SCHEDULE,
      cron: SWEEP_PAYMENT_WEBHOOKS_CRON,
      description: 'Re-queues signed payment webhooks that were stored but never processed.',
      handler: async () => {
        const d = started();
        await sweepPaymentWebhooks({
          db: d.db,
          logger: d.logger,
          enqueue: (webhookId) => enqueuePaymentWebhook(d.queues, webhookId, { deduplicate: false }),
        });
      },
    },
  ],
  start: (ctx: ModuleContext) => {
    deps = buildDeps(ctx);

    // `trade.completed` in M7's vocabulary is one `state_changed` event among fifteen, so the
    // filter is the subscription (trades/domain/events.ts). The handler runs inside the bus's own
    // claim transaction, which is exactly what `releaseEscrow` wants: the journal, the trade's
    // FOR SHARE lock and the escrow_released event all commit together or not at all.
    //
    // What this handler does and does not throw, in full:
    //   * `SETTLED` and `ALREADY_SETTLED` are the two normal outcomes;
    //   * `HELD` and `NOT_RELEASABLE` return. Neither is fixed by retrying — a hold outlives any
    //     backoff, and a trade whose escrow does not match its snapshot needs a person — so the
    //     event is consumed rather than redelivered eight times. Whoever lifts a hold calls
    //     `releaseEscrow` again; `NOT_RELEASABLE` on a COMPLETED trade is logged as the incident
    //     it is, and T-076's pending-release read is the backstop;
    //   * `IdempotencyKeyConflictError` means this trade's escrow was already settled a DIFFERENT
    //     way — a release after a dispute split, or two resolutions disagreeing. Nothing was
    //     posted, and nothing should be: it is dead-lettered immediately as `UnrecoverableError`
    //     rather than retried, because the answer will not change and the attempts would only
    //     delay the alert. This is the one path out of here that throws;
    //   * anything else (a lost connection, a serialisation failure) propagates, and the bus
    //     retries the whole transaction, which is what those need.
    ctx.events.subscribe({
      name: 'ledger.on-trade-completed',
      event: tradeStateChangedEvent,
      handler: async ({ payload, eventId, correlationId }, tx) => {
        if (payload.to !== 'COMPLETED') return;
        const result = await releaseEscrow(
          tx,
          { logger: ctx.logger },
          { tradeId: payload.tradeId, causationId: eventId, ...(correlationId ? { correlationId } : {}) },
        ).catch((error: unknown) => {
          if (!(error instanceof IdempotencyKeyConflictError)) throw error;
          throw new UnrecoverableError(
            `ledger: trade ${payload.tradeId} is already settled another way (${error.difference})`,
          );
        });

        // A completed trade the ledger cannot settle is an incident: the ledger is holding
        // something other than what the trade says it should. A hold is routine. They must not
        // read the same in the logs, because only one of them needs somebody tonight.
        const line = { tradeId: payload.tradeId, outcome: result.outcome };
        if (result.outcome === 'NOT_RELEASABLE') {
          ctx.logger.error({ ...line, reason: result.reason }, 'ledger: a completed trade could not settle');
        } else if (result.outcome === 'HELD') {
          ctx.logger.warn({ ...line, holds: result.holds }, 'ledger: release waiting on a hold');
        } else {
          ctx.logger.info(line, 'ledger: settled a completed trade');
        }
      },
    });
    return Promise.resolve();
  },
  stop: () => {
    deps = undefined;
    return Promise.resolve();
  },
});
