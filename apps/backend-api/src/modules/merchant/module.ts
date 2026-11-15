// The merchant module (T-055): applications, certification and its review.
//
// The composition root: the one file that binds the services to the process's connections and to the
// other modules (through `infrastructure/ports.ts`). Resolved in start(), never at import: the platform
// reads `routes` and `queues` off a module BEFORE start runs, so a handler can only reach for any of this
// when it is called (the shape trust, geo and files use).
import type { Db } from '../../db/index.js';
import { createEncryption } from '../../platform/crypto/encryption.js';
import type { Logger } from '../../platform/logger.js';
import { defineModule, type KomtruModule, type ModuleContext } from '../../platform/module.js';
import { merchantRoutes } from './http/routes.js';
import { bindPorts } from './infrastructure/ports.js';
import { COLLECT_EVIDENCE_QUEUE } from './domain/queues.js';
import { runCollectEvidence } from './jobs/collect-evidence.job.js';
import type { EvidenceJob, MerchantPorts } from './services/ports.js';

interface Runtime {
  db: Db;
  logger: Logger;
  ports: MerchantPorts;
}

export function createMerchantModule(): KomtruModule {
  let runtime: Runtime | undefined;
  const need = (): Runtime => {
    if (!runtime) throw new Error('merchant module: a request or job ran before start()');
    return runtime;
  };

  return defineModule({
    name: 'merchant',

    routes: merchantRoutes({
      db: () => need().db,
      ports: () => need().ports,
      logger: () => need().logger,
    }),

    queues: [
      {
        name: COLLECT_EVIDENCE_QUEUE,
        concurrency: 2,
        // The lookup is trust's billed call and trust owns its retry policy; this job only asks for it and
        // reads back, so a transient failure is worth a few cheap tries.
        attempts: 3,
        backoffMs: 5_000,
        process: async (data: EvidenceJob) => {
          const { db, logger, ports } = need();
          await runCollectEvidence({ db, logger, ports }, data);
        },
      },
    ],

    start: (ctx: ModuleContext) => {
      runtime = {
        db: ctx.db,
        logger: ctx.logger,
        // Throws here, naming its variable, when ENCRYPTION_KEY is missing: trust refuses to start for the
        // same reason, because an identifier can only be queued sealed.
        ports: bindPorts({
          db: ctx.db,
          config: ctx.config,
          logger: ctx.logger,
          queues: ctx.queues,
          encryption: createEncryption(ctx.config),
        }),
      };
      return Promise.resolve();
    },

    stop: () => {
      runtime = undefined;
      return Promise.resolve();
    },
  });
}

export const merchantModule = createMerchantModule();
