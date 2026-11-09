// The trades module's runtime (T-061): its routes, and the two subscribers that answer an invitation
// being claimed or expiring. The state machine, gates and tables are in the barrel; this is what
// needs the process's connections, so it is built by the registry rather than at import.
import {
  identityPartyInvitationClaimedEvent,
  identityPartyInvitationExpiredEvent,
} from '../identity/index.js';
import { createLookupBudget } from '../identity/index.js';
import { getCitiesByIds } from '../geo/index.js';
import { createEncryption } from '../../platform/crypto/encryption.js';
import { createHmacHasher } from '../../platform/crypto/hmac.js';
import { ApiError } from '../../platform/errors.js';
import { defineModule, type KomtruModule, type ModuleContext } from '../../platform/module.js';
import type { Db } from '../../db/index.js';
import type { Redis } from 'ioredis';
import type { AppConfig } from '../../config/env.js';
import type { Logger } from '../../platform/logger.js';
import { createConfigAccessor } from '../config/index.js';
import { tradeStateChangedEvent } from './domain/events.js';
import { fulfilmentRoutes } from './http/fulfilment.routes.js';
import { tradeRoutes } from './http/trade.routes.js';
import { deliveryDeadlineJob } from './jobs/deliveryDeadline.job.js';
import { openDeliveryDeadline } from './services/deadline.service.js';
import { noLogisticsCompanies, noParkCoverage, type FulfilmentDeps } from './services/fulfilmentPorts.js';
import {
  postgresGrantProofAccess,
  postgresProofFiles,
  postgresRevokeProofAccess,
  postgresStandards,
  snapshotFees,
  type TradeDeps,
} from './services/ports.js';
import { claimTradeInvitation, expireTradeInvitation } from './services/proposal.service.js';

export interface TradesModuleOptions {
  db: Db;
  redis: Redis;
  config: AppConfig;
  logger: Logger;
}

export function buildTradeDeps({ db, redis, config, logger }: TradesModuleOptions): TradeDeps {
  if (!config.identity.hmacPepper)
    throw new Error('IDENTITY_HMAC_PEPPER is required to build the trades module');
  const accessor = createConfigAccessor(db, redis, logger);
  return {
    db,
    cities: getCitiesByIds,
    party: { db, budget: createLookupBudget({ redis, logger }) },
    invitations: {
      db,
      hasher: createHmacHasher(config.identity.hmacPepper),
      encryption: createEncryption(config),
      logger,
    },
    standards: postgresStandards(db),
    proofFiles: postgresProofFiles(),
    grantProofAccess: postgresGrantProofAccess(db),
    revokeProofAccess: postgresRevokeProofAccess(db),
    snapshotFees,
    graceHours: () => accessor.getInteger('trades', 'unconfirmed_delivery_grace_hours'),
  };
}

/**
 * Fulfilment's ports. The two seams are explicit: until the logistics schema (T-085, T-087) and Park's
 * coverage service (T-093) exist there are no companies to offer and no serviceable city, which is
 * what the ship step then truthfully reports.
 */
export function buildFulfilmentDeps(deps: TradeDeps): FulfilmentDeps {
  return {
    db: deps.db,
    cities: deps.cities,
    proofFiles: deps.proofFiles,
    standards: deps.standards,
    logistics: noLogisticsCompanies,
    park: noParkCoverage,
    now: () => new Date(),
  };
}

export function createTradesModule(options: TradesModuleOptions): KomtruModule {
  const deps = buildTradeDeps(options);
  const fulfilment = buildFulfilmentDeps(deps);

  return defineModule({
    name: 'trades',
    routes: [...tradeRoutes(() => deps), ...fulfilmentRoutes(() => fulfilment)],
    schedules: [deliveryDeadlineJob(() => fulfilment)],

    start: (ctx: ModuleContext) => {
      // Both subscribers act only on invitations whose context is a trade; identity publishes the
      // same events for every other invitation too.
      ctx.events.subscribe({
        name: 'trades.on-invitation-claimed',
        event: identityPartyInvitationClaimedEvent,
        handler: async ({ payload }) => {
          if (payload.contextType !== 'TRADE' || !payload.contextId) return;
          try {
            await claimTradeInvitation(deps, { userId: payload.claimedByUserId, tradeId: payload.contextId });
          } catch (error) {
            // A refusal (no usable address yet, a merchant claiming a buyer invitation) is the
            // person's to resolve, and the trade stays PENDING_COUNTERPARTY until they call
            // POST /trades/:id/claim. Retrying the event would only fail the same way.
            if (error instanceof ApiError) {
              ctx.logger.info({ tradeId: payload.contextId, code: error.code }, 'trades: claim deferred');
              return;
            }
            throw error;
          }
        },
      });
      ctx.events.subscribe({
        name: 'trades.on-invitation-expired',
        event: identityPartyInvitationExpiredEvent,
        handler: async ({ payload }) => {
          if (payload.contextType !== 'TRADE' || !payload.contextId) return;
          await expireTradeInvitation(deps, {
            tradeId: payload.contextId,
            invitationId: payload.invitationId,
          });
        },
      });
      // Funding starts the delivery clock (DE1, DE3). Idempotent, so a redelivered event is harmless;
      // it runs in the event's own transaction, so the deadline and the claim on the event commit together.
      ctx.events.subscribe({
        name: 'trades.open-delivery-deadline',
        event: tradeStateChangedEvent,
        handler: async ({ payload }, tx) => {
          if (payload.to !== 'FUNDED') return;
          await openDeliveryDeadline(fulfilment, tx, payload.tradeId);
        },
      });
      return Promise.resolve();
    },
  });
}
