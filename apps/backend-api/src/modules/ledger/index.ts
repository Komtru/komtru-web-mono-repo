// The ledger module's public surface (m8 §2). Other modules reach it only through this file.
//
// Two halves meet here: T-070's chart of accounts, journal and balances — the ledger never transitions
// a trade and never computes a fee, amounts arrive already computed from the trade's snapshot
// (design §6.5) — and T-071's provider layer, the adapter interface, the Paystack implementation,
// the registry and its jobs. Funding and the webhook route are T-072; payouts (accounts, preferences,
// withdrawals, the automatic sweep and holds) are T-073.
import { UnrecoverableError } from 'bullmq';
import type { Redis } from 'ioredis';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/index.js';
import type { QueueFactory } from '../../platform/queue/factory.js';
import type { Logger } from '../../platform/logger.js';
import { defineModule, type ModuleContext } from '../../platform/module.js';
import { tradeRefundRequestedEvent, tradeStateChangedEvent } from '../trades/index.js';
import { findBankNameMatchFor } from '../trust/index.js';
import { createEncryption } from '../../platform/crypto/encryption.js';
import { createHmacHasher } from '../../platform/crypto/hmac.js';
import {
  paymentEscrowRefundedEvent,
  paymentEscrowReleasedEvent,
  payoutRequestedEvent,
} from './domain/events.js';
import type { VerifiedRefundView } from './domain/refunds.js';
import type { VerifiedTransferView } from './domain/payouts.js';
import { payoutRoutes } from './http/payoutRoutes.js';
import { refundRoutes } from './http/refundRoutes.js';
import {
  enqueueProcessPayout,
  enqueueVerifyPayoutAccount,
  PAYOUT_JOB_ATTEMPTS,
  PAYOUT_JOB_BACKOFF_MS,
  PROCESS_PAYOUT_QUEUE,
  processPayoutJob,
  VERIFY_PAYOUT_ACCOUNT_QUEUE,
  verifyPayoutAccountJob,
  type ProcessPayoutJob,
  type VerifyPayoutAccountJob,
} from './jobs/payouts.job.js';
import type { PayoutAccountCrypto } from './services/payoutAccount.service.js';
import { resolvePayout, type PayoutDispatchDeps } from './services/payoutDispatch.service.js';
import { payOutRelease, sweepAutoPayouts, sweepInFlightPayouts } from './services/payoutTriggers.service.js';
import { IdempotencyKeyConflictError } from './domain/journal.js';
import { createRedisBankListCache, type BankListCache } from './infrastructure/bankListCache.js';
import type { ProviderRegistry } from './infrastructure/providerRegistry.js';
import { paymentRoutes } from './http/routes.js';
import { releaseEscrow } from './services/release.service.js';
import { decideRefund } from './services/refund.service.js';
import { resolveRefundEvent, type RefundDispatchDeps } from './services/refundDispatch.service.js';
import {
  enqueueProcessRefund,
  PROCESS_REFUND_QUEUE,
  processRefundJob,
  REFUND_JOB_ATTEMPTS,
  REFUND_JOB_BACKOFF_MS,
  sweepInFlightRefunds,
  type ProcessRefundJob,
} from './jobs/refund.job.js';
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
import { chargeVerifier, paymentProviders, refundVerifier, transferVerifier } from './jobs/providers.js';
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
export * from './domain/refunds.js';
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
  decideRefund,
  REFUNDABLE_STATUSES,
  type RefundDeps,
  type RefundInput,
  type RefundResult,
} from './services/refund.service.js';
export {
  executePayout,
  placePayoutHold,
  releasePayoutHold,
  type ExecutePayoutDeps,
  type ExecutePayoutInput,
  type ExecutePayoutResult,
  type PlaceHoldInput,
} from './services/payout.service.js';
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

// Paying a seller out (T-073).
export { PROCESS_PAYOUT_QUEUE, VERIFY_PAYOUT_ACCOUNT_QUEUE };

// Refunding a buyer (T-075).
export { PROCESS_REFUND_QUEUE };

/** Every five minutes: re-drives refunds whose dispatch was lost or that the provider went quiet on. */
export const SWEEP_REFUNDS_CRON = '*/5 * * * *';
export const SWEEP_REFUNDS_SCHEDULE = 'ledger.sweep-refunds';

/** Every five minutes: re-drives payouts and payout accounts whose job was lost. */
export const SWEEP_PAYOUTS_CRON = '*/5 * * * *';
export const SWEEP_PAYOUTS_SCHEDULE = 'ledger.sweep-payouts';

/** 09:00 Africa/Lagos: working hours, after the 03:15 bank-list refresh (owner decision 5). */
export const SWEEP_PAYOUTS_AUTO_CRON = '0 9 * * *';
export const SWEEP_PAYOUTS_AUTO_SCHEDULE = 'ledger.sweep-payouts-auto';

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
  verifyTransfer: (reference: string) => Promise<VerifiedTransferView>;
  verifyRefund: (providerRefundId: string) => Promise<VerifiedRefundView>;
  /** Absent without ENCRYPTION_KEY and IDENTITY_HMAC_PEPPER: payout accounts then answer 503. */
  crypto: PayoutAccountCrypto | undefined;
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
    verifyTransfer: transferVerifier(paystack),
    verifyRefund: refundVerifier(paystack),
    crypto: payoutCrypto(ctx.config, ctx.logger),
  };
};

/**
 * The two secrets an account number is kept under — the platform encryption key and the identifier
 * pepper trust already hashes bank accounts with. Missing either, payout accounts fail closed (503)
 * rather than storing a number in the clear; everything else in the ledger still runs.
 */
const payoutCrypto = (config: AppConfig, logger: Logger): PayoutAccountCrypto | undefined => {
  const pepper = config.identity.hmacPepper;
  if (!config.crypto.encryptionKey || !pepper) {
    logger.warn('ledger: ENCRYPTION_KEY or IDENTITY_HMAC_PEPPER is not set; payout accounts are unavailable');
    return undefined;
  }
  return { encryption: createEncryption(config), hasher: createHmacHasher(pepper) };
};

const dispatchDeps = (): PayoutDispatchDeps => {
  const d = started();
  const adapter = d.registry.getAdapter('PAYSTACK');
  return {
    db: d.db,
    logger: d.logger,
    initiateTransfer: (input) => adapter.initiateTransfer(input),
    verifyTransfer: d.verifyTransfer,
  };
};

const refundDispatchDeps = (): RefundDispatchDeps => {
  const d = started();
  const adapter = d.registry.getAdapter('PAYSTACK');
  return {
    db: d.db,
    logger: d.logger,
    initiateRefund: (input) => adapter.initiateRefund(input),
    verifyRefund: d.verifyRefund,
  };
};

const accountJobDeps = () => {
  const d = started();
  const crypto = d.crypto;
  // Thrown, so the job retries once the process is configured; the account stays pending meanwhile.
  if (!crypto)
    throw new Error('ledger: payout account verification needs ENCRYPTION_KEY and IDENTITY_HMAC_PEPPER');
  return {
    db: d.db,
    logger: d.logger,
    crypto,
    adapter: d.registry.getAdapter('PAYSTACK'),
    readNameMatch: (input: { userId: string; bankCode: string; accountNumber: string }) =>
      findBankNameMatchFor(d.db, crypto.hasher, input),
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
    resolvePayout: (payoutId: string) => resolvePayout(dispatchDeps(), payoutId),
    resolveRefund: (event: { chargeReference: string; providerRefundId: string }) =>
      resolveRefundEvent(refundDispatchDeps(), { provider: 'PAYSTACK', ...event }),
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
    ...payoutRoutes(() => {
      const d = started();
      return {
        banks: d.cache,
        accounts: {
          db: d.db,
          crypto: d.crypto,
          banks: d.cache,
          logger: d.logger,
          enqueueVerify: (payoutAccountId) => enqueueVerifyPayoutAccount(d.queues, payoutAccountId),
        },
        payouts: { db: d.db, logger: d.logger },
      };
    }),
    ...refundRoutes(() => ({ db: started().db })),
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
    {
      name: VERIFY_PAYOUT_ACCOUNT_QUEUE,
      attempts: PAYOUT_JOB_ATTEMPTS,
      backoffMs: PAYOUT_JOB_BACKOFF_MS,
      process: async (data: VerifyPayoutAccountJob) => await verifyPayoutAccountJob(accountJobDeps(), data),
    },
    {
      name: PROCESS_PAYOUT_QUEUE,
      attempts: PAYOUT_JOB_ATTEMPTS,
      backoffMs: PAYOUT_JOB_BACKOFF_MS,
      process: async (data: ProcessPayoutJob, job, token) =>
        await processPayoutJob(dispatchDeps(), data, job, token),
    },
    {
      name: PROCESS_REFUND_QUEUE,
      attempts: REFUND_JOB_ATTEMPTS,
      backoffMs: REFUND_JOB_BACKOFF_MS,
      process: async (data: ProcessRefundJob, job, token) =>
        await processRefundJob(refundDispatchDeps(), data, job, token),
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
    {
      name: SWEEP_PAYOUTS_SCHEDULE,
      cron: SWEEP_PAYOUTS_CRON,
      description: 'Re-drives payouts and payout accounts whose job never ran or went quiet.',
      handler: async () => {
        const d = started();
        await sweepInFlightPayouts({
          db: d.db,
          logger: d.logger,
          enqueuePayout: (payoutId) => enqueueProcessPayout(d.queues, payoutId, { deduplicate: false }),
          enqueueAccount: (id) => enqueueVerifyPayoutAccount(d.queues, id, { deduplicate: false }),
        });
      },
    },
    {
      name: SWEEP_REFUNDS_SCHEDULE,
      cron: SWEEP_REFUNDS_CRON,
      description: 'Re-drives refunds whose dispatch never ran or that the provider went quiet on.',
      handler: async () => {
        const d = started();
        await sweepInFlightRefunds({
          db: d.db,
          logger: d.logger,
          enqueue: (refundId) => enqueueProcessRefund(d.queues, refundId, { deduplicate: false }),
        });
      },
    },
    {
      name: SWEEP_PAYOUTS_AUTO_SCHEDULE,
      cron: SWEEP_PAYOUTS_AUTO_CRON,
      description: 'Pays out the available balance of daily, weekly (Monday) and monthly (1st) sellers.',
      handler: async () => {
        const d = started();
        await sweepAutoPayouts({ db: d.db, logger: d.logger });
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

    // T-075: a trade asks for its escrow back (an approved cancellation, a seller who cannot fulfil,
    // an overdue delivery). The decision posts in the bus's own claim transaction, so the journal, the
    // refund row, the trade's FOR SHARE lock and the escrow_refunded event commit together or not at
    // all. Every refusal returns — a hold, a trade that moved on, books that do not match the snapshot
    // — because none is fixed by retrying; `decideRefund` logs each one at the level it deserves. A
    // lost connection, or the database's own cumulative guard refusing, propagates and is retried.
    ctx.events.subscribe({
      name: 'ledger.on-refund-requested',
      event: tradeRefundRequestedEvent,
      handler: async ({ payload, eventId, correlationId }, tx) => {
        const result = await decideRefund(
          tx,
          { logger: ctx.logger },
          {
            tradeId: payload.tradeId,
            reason: payload.reason,
            causationId: eventId,
            ...(correlationId ? { correlationId } : {}),
          },
        );
        ctx.logger.info({ tradeId: payload.tradeId, outcome: result.outcome }, 'ledger: refund requested');
      },
    });

    // The refund row and its decision commit with this event; the dispatch is queued only after that
    // commit, so the job never looks for a refund that is not there yet.
    ctx.events.subscribe({
      name: 'ledger.on-escrow-refunded',
      event: paymentEscrowRefundedEvent,
      handler: async ({ payload }) => {
        await enqueueProcessRefund(started().queues, payload.refundId);
      },
    });

    // The payout row and its requested event commit together; this queues the dispatch only after
    // that commit, so the job never looks for a payout that is not there yet.
    ctx.events.subscribe({
      name: 'ledger.on-payout-requested',
      event: payoutRequestedEvent,
      handler: async ({ payload }) => {
        await enqueueProcessPayout(started().queues, payload.payoutId);
      },
    });

    // AUTO_IMMEDIATE (T-073): the proceeds a release just credited, paid out in the same claim
    // transaction that records the event as handled. A skip returns; a lost connection propagates
    // and the bus retries, which is safe because the payout is keyed by the release journal.
    ctx.events.subscribe({
      name: 'ledger.on-escrow-released',
      event: paymentEscrowReleasedEvent,
      handler: async ({ payload }, tx) => {
        await payOutRelease(tx, { logger: ctx.logger }, payload);
      },
    });
    return Promise.resolve();
  },
  stop: () => {
    deps = undefined;
    return Promise.resolve();
  },
});
