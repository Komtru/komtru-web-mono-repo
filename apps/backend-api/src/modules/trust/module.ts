// The trust module (M6): the §11 user surface, the two provider-touching queues, and the sweep that
// stops an unanswered verification hanging forever.
//
// This is also the module's composition root — the one file allowed to reach into `jobs/`, where the
// KYC adapter is constructed (design §4.4, T-028). Nothing in `services/` or `http/` can follow that
// path, which is what keeps every provider call inside a job.
import type { TrustConfig } from '../../config/env.js';
import type { Db } from '../../db/index.js';
import { createEncryption, type Encryption } from '../../platform/crypto/encryption.js';
import { createHmacHasher, type HmacHasher } from '../../platform/crypto/hmac.js';
import type { Logger } from '../../platform/logger.js';
import { defineModule, type KomtruModule, type ModuleContext } from '../../platform/module.js';
import type { QueueFactory } from '../../platform/queue/factory.js';
import type { SocketGateway } from '../socket/index.js';
import {
  TRUST_QUEUES,
  TRUST_SCHEDULES,
  type BankMatchJob,
  type BusinessCheckJob,
  type IdentityCheckJob,
  type LivenessCheckJob,
  type SocialProofCheckJob,
} from './domain/queues.js';
import { trustAdminRoutes } from './http/admin.routes.js';
import { trustRoutes } from './http/routes.js';
import { bindStore } from './infrastructure/postgres/bind-store.js';
import type { TrustStore } from './infrastructure/postgres/store.js';
import type { TrustJobDeps } from './jobs/deps.js';
import { kycProvider, socialProofAdapter } from './jobs/providers.js';
import { runExpireStale } from './jobs/expire-stale.job.js';
import { runBankMatchCheck } from './jobs/run-bank-match.job.js';
import { runBusinessCheck } from './jobs/run-business-check.job.js';
import { runIdentityCheck } from './jobs/run-identity-check.job.js';
import { runLivenessCheck } from './jobs/run-liveness-check.job.js';
import { runSocialProofCheck, type SocialProofJobDeps } from './jobs/run-social-proof-check.job.js';

/**
 * 31 past the hour, off the top like files' sweeps, so the hourly jobs do not all land together.
 *
 * Hourly rather than every minute because what it sweeps is bounded by `TRUST_REQUEST_TTL_MINUTES`
 * (a day by default) — a request an hour past its deadline is already a request nobody is waiting on.
 */
export const EXPIRE_STALE_CRON = '31 * * * *';

/**
 * Two at a time. The provider is the bottleneck, not the database, and a check that queues behind
 * four others is a user watching a spinner on the screen that gates selling.
 */
const JOB_CONCURRENCY = 2;

/**
 * Three attempts from 5s.
 *
 * A KYC provider costs money per call, so this is deliberately far tighter than the files module's
 * eight-from-15s: there, a retry re-reads a free Admin API, and here each one may be billed. Three
 * absorbs a blip; beyond that the expiry sweep is the right answer, and a human is better placed to
 * decide whether to spend more.
 */
const JOB_ATTEMPTS = 3;
const JOB_BACKOFF_MS = 5_000;

interface TrustRuntime {
  db: Db;
  store: TrustStore;
  queues: QueueFactory;
  config: TrustConfig;
  hasher: HmacHasher;
  encryption: Encryption;
  logger: Logger;
  jobs: TrustJobDeps;
  /**
   * Narrower than `jobs`, and deliberately so: the social-proof lookup has no business holding a
   * `KycProviderAdapter`, and a job that cannot reach one cannot spend a billed call by accident.
   */
  socialJobs: SocialProofJobDeps;
}

export interface TrustModuleOptions {
  /**
   * The socket gateway, taken as a port rather than reached for.
   *
   * It arrives from `createModules`, which builds the socket module first so this one can have it.
   * The push itself happens in the worker and travels to the API instances over the Redis adapter.
   */
  gateway: SocketGateway;
}

export function createTrustModule(options: TrustModuleOptions): KomtruModule {
  // Resolved in start(), never at import: the platform reads `routes`, `queues` and `schedules` off
  // a module BEFORE start runs, so a handler can only reach for this when it is called.
  let runtime: TrustRuntime | undefined;
  const need = (): TrustRuntime => {
    if (!runtime) throw new Error('trust module: a job ran before start() — the module was not started');
    return runtime;
  };

  return defineModule({
    name: 'trust',

    routes: [
      ...trustRoutes({
        store: () => need().store,
        hasher: () => need().hasher,
        encryption: () => need().encryption,
        requestTtlMinutes: () => need().config.requestTtlMinutes,
        logger: () => need().logger,
        queues: () => need().queues,
      }),
      // M6 §11's admin half (T-052): the KYC queue, the duplicate flags and the override.
      ...trustAdminRoutes({ db: () => need().db }),
    ],

    queues: [
      {
        name: TRUST_QUEUES.IDENTITY_CHECK,
        concurrency: JOB_CONCURRENCY,
        attempts: JOB_ATTEMPTS,
        backoffMs: JOB_BACKOFF_MS,
        // `async` so a synchronous throw reaches the queue as a rejected job rather than as an
        // exception on the worker's own call stack.
        process: async (data: IdentityCheckJob) => await runIdentityCheck(need().jobs, data),
      },
      {
        name: TRUST_QUEUES.LIVENESS_CHECK,
        concurrency: JOB_CONCURRENCY,
        attempts: JOB_ATTEMPTS,
        backoffMs: JOB_BACKOFF_MS,
        process: async (data: LivenessCheckJob) => await runLivenessCheck(need().jobs, data),
      },
      {
        name: TRUST_QUEUES.BUSINESS_CHECK,
        concurrency: JOB_CONCURRENCY,
        attempts: JOB_ATTEMPTS,
        backoffMs: JOB_BACKOFF_MS,
        process: async (data: BusinessCheckJob) => await runBusinessCheck(need().jobs, data),
      },
      {
        name: TRUST_QUEUES.BANK_MATCH,
        concurrency: JOB_CONCURRENCY,
        attempts: JOB_ATTEMPTS,
        backoffMs: JOB_BACKOFF_MS,
        process: async (data: BankMatchJob) => await runBankMatchCheck(need().jobs, data),
      },
      {
        name: TRUST_QUEUES.SOCIAL_PROOF_CHECK,
        concurrency: JOB_CONCURRENCY,
        attempts: JOB_ATTEMPTS,
        backoffMs: JOB_BACKOFF_MS,
        process: async (data: SocialProofCheckJob) => await runSocialProofCheck(need().socialJobs, data),
      },
    ],

    schedules: [
      {
        name: TRUST_SCHEDULES.EXPIRE_STALE,
        cron: EXPIRE_STALE_CRON,
        description: 'Expires verification requests a provider never answered',
        handler: async (firedAt) => void (await runExpireStale(need().jobs, firedAt)),
      },
    ],

    start: (ctx: ModuleContext) => {
      const config = ctx.config.trust;

      /**
       * Both of these throw here, naming their variable, rather than at the first submission.
       *
       * `createEncryption` is the important one: without `ENCRYPTION_KEY` there is no way to put an
       * identifier on a queue safely, and the tempting fallback — enqueue it in the clear — breaks
       * D1 in the one place nobody would look. A process that cannot keep that promise should not
       * serve the endpoint that makes it.
       */
      const encryption = createEncryption(ctx.config);
      if (!ctx.config.identity.hmacPepper) {
        // Shared with identity deliberately: §12 names the identifier hash key as the one secret
        // here whose leak has an irreversible, cross-account consequence, and a second variable now
        // would mean two keys to move to KMS later rather than one.
        throw new Error('IDENTITY_HMAC_PEPPER is required to build the trust module');
      }
      const hasher = createHmacHasher(ctx.config.identity.hmacPepper);
      const store = bindStore(ctx.db);

      runtime = {
        db: ctx.db,
        store,
        queues: ctx.queues,
        config,
        hasher,
        encryption,
        logger: ctx.logger,
        jobs: {
          store,
          // The one call into jobs/, and so the one place an adapter is chosen. A FAKE selection
          // warns here; a DOJAH selection with no credentials fails here, naming them.
          adapter: kycProvider(config, ctx.logger),
          hasher,
          encryption,
          gateway: options.gateway,
          logger: ctx.logger,
        },
        socialJobs: {
          store,
          social: socialProofAdapter(ctx.logger),
          gateway: options.gateway,
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
