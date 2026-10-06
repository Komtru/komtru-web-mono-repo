// The files module: the M20 §9 routes, the two provider-touching queues, the two sweeps, and the seed
// that reconciles `storage_accounts` against this environment's credentials.
//
// This is also the module's composition root — the one file allowed to reach into `jobs/`, where the
// Cloudinary client is constructed (design §4.4, T-028). Nothing in `services/` or `http/` can follow
// that path, which is what keeps every network call inside a job.
import type { Db } from '../../db/index.js';
import { loadConfig, type FilesConfig } from '../../config/env.js';
import { createLogger, type Logger } from '../../platform/logger.js';
import {
  defineModule,
  type KomtruModule,
  type ModuleContext,
  type SeedableModule,
} from '../../platform/module.js';
import type { QueueFactory } from '../../platform/queue/factory.js';
import { isAccountConfigured } from './infrastructure/credentials.js';
import {
  FILES_QUEUES,
  FILES_SCHEDULES,
  type DestroyAssetJob,
  type FinalizeUploadJob,
} from './domain/queues.js';
import { filesRoutes } from './http/routes.js';
import type { FileJobDeps } from './jobs/deps.js';
import { runDestroyAsset } from './jobs/destroy-asset.job.js';
import { runFinalizeUpload } from './jobs/finalize-upload.job.js';
import { storageProvider } from './jobs/providers.js';
import { runPurgeAbandoned } from './jobs/purge-abandoned.job.js';
import { bindStore } from './jobs/store.js';
import { runSyncUsage } from './jobs/sync-usage.job.js';
import { DEFAULT_ACCOUNTS, seedStorageAccounts } from './services/account.service.js';

/** 07 past the hour: off the top, so it does not pile onto every other hourly job at once. */
export const SYNC_USAGE_CRON = '7 * * * *';
/** 23 past, for the same reason, and after the sweep that might have changed what is pending. */
export const PURGE_ABANDONED_CRON = '23 * * * *';

/**
 * Two at a time. The bottleneck is Cloudinary's Admin API, not the database, and a finalize that
 * queues behind four others is a user watching a spinner for no reason.
 */
const JOB_CONCURRENCY = 2;

interface FilesRuntime {
  db: Db;
  queues: QueueFactory;
  config: FilesConfig;
  logger: Logger;
  jobs: FileJobDeps;
}

/**
 * The five default `storage_accounts` rows, reconciled against what this environment has credentials
 * for: reference data, not schema, so it is a seed rather than a migration (M20 §5's runbook adds a
 * sixth account through the API, with no deploy).
 *
 * Exported separately from the module because the seed runner has only a database — building the
 * whole module would demand a queue factory and a Cloudinary client to insert five rows. It reads the
 * credentials straight from `process.env` through `loadConfig` for the same reason: `pnpm db:migrate`
 * has no `AppConfig` to hand it, and the seed must know which of the five this box can actually use.
 * Both the module and the seed registry use this one value, so they cannot drift.
 */
export const filesSeed: SeedableModule = {
  name: 'files',
  seed: (db: Db) => {
    const config = loadConfig(process.env);
    return seedStorageAccounts(db, config.files, createLogger(config));
  },
};

export function createFilesModule(): KomtruModule {
  // Resolved in start(), never at import. The platform reads `routes`, `queues` and `schedules` off a
  // module BEFORE start runs, so a handler cannot close over anything the context carries — it can
  // only reach for it when it is called, which is always after start.
  let runtime: FilesRuntime | undefined;
  /**
   * Every job and schedule handler below is `async` so this throw reaches the queue as a rejection
   * rather than synchronously — the same reason ledger's are. A synchronous throw out of a BullMQ
   * processor is not a failed job, it is an exception in the worker's own call stack.
   */
  const need = (): FilesRuntime => {
    if (!runtime) throw new Error('files module: a job ran before start() — the module was not started');
    return runtime;
  };

  return defineModule({
    // name and seed from the one shared value above, so the registry and the seed runner agree.
    ...filesSeed,

    routes: filesRoutes({
      db: () => need().db,
      queues: () => need().queues,
      config: () => need().config,
      logger: () => need().logger,
    }),

    queues: [
      {
        name: FILES_QUEUES.FINALIZE,
        concurrency: JOB_CONCURRENCY,
        process: async (data: FinalizeUploadJob) => await runFinalizeUpload(need().jobs, data),
      },
      {
        name: FILES_QUEUES.DESTROY,
        concurrency: JOB_CONCURRENCY,
        process: async (data: DestroyAssetJob) => await runDestroyAsset(need().jobs, data),
      },
    ],

    schedules: [
      {
        name: FILES_SCHEDULES.SYNC_USAGE,
        cron: SYNC_USAGE_CRON,
        description: 'Polls each storage account’s Cloudinary usage and flips its status before uploads fail',
        handler: async () => await runSyncUsage(need().jobs),
      },
      {
        name: FILES_SCHEDULES.PURGE_ABANDONED,
        cron: PURGE_ABANDONED_CRON,
        description: 'Tombstones upload tickets that were issued and never used',
        handler: async (firedAt) => await runPurgeAbandoned(need().jobs, firedAt),
      },
    ],

    start: (ctx: ModuleContext) => {
      const config = ctx.config.files;
      warnAboutMissingAccounts(config, ctx.logger);
      runtime = {
        db: ctx.db,
        queues: ctx.queues,
        config,
        logger: ctx.logger,
        jobs: {
          store: bindStore(ctx.db),
          storage: storageProvider({ files: config, logger: ctx.logger }),
          files: config,
          logger: ctx.logger,
        },
      };
      return Promise.resolve();
    },

    stop: () => {
      runtime = undefined;
      return Promise.resolve();
    },
  });
}

export const filesModule = createFilesModule();

/**
 * WARN rather than fail, the posture notify takes for a missing provider credential.
 *
 * A staging box whose secrets land a minute later should still boot. What must not happen is silence:
 * an upload into an unconfigured pool fails closed with a clear error (D6) rather than vanishing, and
 * an operator should have been told at boot which prefix is the reason.
 */
function warnAboutMissingAccounts(config: FilesConfig, logger: Logger): void {
  const missing = DEFAULT_ACCOUNTS.filter((account) => !isAccountConfigured(config, account.prefix));
  if (missing.length === 0) return;
  logger.warn(
    { accounts: missing.map((account) => `${account.label} (${account.prefix})`) },
    'files: storage accounts with no credentials here — uploads to their pools will fail closed',
  );
}
