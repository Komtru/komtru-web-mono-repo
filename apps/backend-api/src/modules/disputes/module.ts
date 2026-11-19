// The disputes module (T-080, T-081): M3's financial case, its mediation window, its evidence
// window and its one appeal. Registered after trades, ledger and cases, because it drives the
// first two through events and indexes itself into the third.
import type { Redis } from 'ioredis';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/index.js';
import type { Logger } from '../../platform/logger.js';
import { defineModule, type KomtruModule, type ModuleContext } from '../../platform/module.js';
import { createConfigAccessor } from '../config/index.js';
import { disputeRoutes } from './http/routes.js';
import {
  custodyPhotos,
  grantEvidenceAccess,
  moveTradeToDisputed,
  shipmentTimeline,
  tradeForDispute,
  tradeMedia,
} from './infrastructure/adapters.js';
import { appealDeadlineJob, evidenceDeadlineJob, mediationDeadlineJob } from './jobs/deadlines.job.js';
import { noRelatedUsers, type DisputePorts } from './services/ports.js';
import type { SweepDeps } from './services/sweeps.js';

export interface DisputesModuleOptions {
  now?: () => Date;
}

export function createDisputesModule(options: DisputesModuleOptions = {}): KomtruModule {
  // Resolved in start(): the platform reads `routes` before start runs, so a handler can only
  // reach for the process's connections when it is called (the shape cases, geo and files use).
  let ports: DisputePorts | undefined;
  let db: Db | undefined;
  let logger: Logger | undefined;

  const need = <T>(value: T | undefined, what: string): T => {
    if (value === undefined) throw new Error(`disputes module: ${what} was used before start()`);
    return value;
  };

  const build = (deps: { db: Db; redis: Redis; config: AppConfig; logger: Logger }): DisputePorts => {
    // Read through a thunk so a window length is never frozen at boot: an operator who widens the
    // appeal window should see the next case get the new one.
    const settings = createConfigAccessor(deps.db, deps.redis, deps.logger);
    return {
      db: deps.db,
      now: options.now ?? (() => new Date()),
      tradeForDispute,
      moveTradeToDisputed,
      tradeMedia,
      custodyPhotos,
      shipmentTimeline,
      grantEvidenceAccess,
      // SEAM(T-080): see services/ports.ts. The rule is written and tested; the signal is not
      // available yet, so the exclusion is inert and the question is parked for the owner.
      relatedUsers: noRelatedUsers,
      mediationWindowHours: () => settings.getInteger('disputes', 'mediation_window_hours'),
      evidenceWindowDays: () => settings.getInteger('disputes', 'evidence_window_days'),
      appealWindowDays: () => settings.getInteger('disputes', 'appeal_window_days'),
    };
  };

  const sweeps = (): SweepDeps => ({
    db: need(db, 'the database'),
    ports: need(ports, 'the ports'),
    logger,
  });

  return defineModule({
    name: 'disputes',
    routes: disputeRoutes({
      db: () => need(db, 'the database'),
      ports: () => need(ports, 'the ports'),
    }),
    schedules: [mediationDeadlineJob(sweeps), evidenceDeadlineJob(sweeps), appealDeadlineJob(sweeps)],

    start: (ctx: ModuleContext) => {
      db = ctx.db;
      logger = ctx.logger;
      ports = build({ db: ctx.db, redis: ctx.redis, config: ctx.config, logger: ctx.logger });
      return Promise.resolve();
    },

    stop: () => {
      db = undefined;
      ports = undefined;
      logger = undefined;
      return Promise.resolve();
    },
  });
}
