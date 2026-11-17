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
import type { SocketGateway } from '../socket/index.js';
import { tradeStateChangedEvent } from './domain/events.js';
import { cancellationRoutes } from './http/cancellation.routes.js';
import { fulfilmentRoutes } from './http/fulfilment.routes.js';
import { evidenceRoutes } from './http/evidence.routes.js';
import { inspectionRoutes } from './http/inspection.routes.js';
import { tradeRoutes } from './http/trade.routes.js';
import { viewerRoutes } from './http/viewer.routes.js';
import { deliveryDeadlineJob } from './jobs/deliveryDeadline.job.js';
import { graceDeadlineJob } from './jobs/graceDeadline.job.js';
import { inspectionDeadlineJob } from './jobs/inspectionDeadline.job.js';
import { inspectionReminderJob } from './jobs/inspectionReminder.job.js';
import {
  ledgerEscrowFundedEvent,
  ledgerEscrowRefundedEvent,
  ledgerEscrowReleasedEvent,
} from './domain/ledgerEvents.js';
import { lapsePendingCancellation, refundTrade } from './services/cancellation.service.js';
import { openDeliveryDeadline } from './services/deadline.service.js';
import { fundTrade } from './services/funding.service.js';
import { settleTrade } from './services/inspectionDeadline.service.js';
import {
  postgresFileProgress,
  postgresGrantEvidenceAccess,
  type EvidenceDeps,
} from './services/evidencePorts.js';
import { noDisputes, type InspectionDeps } from './services/inspectionPorts.js';
import { noLogisticsCompanies, noParkCoverage, type FulfilmentDeps } from './services/fulfilmentPorts.js';
import {
  postgresGrantProofAccess,
  postgresCounterpartyDisplays,
  postgresProofFiles,
  postgresRevokeProofAccess,
  postgresStandards,
  snapshotFees,
  type TradeDeps,
} from './services/ports.js';
import {
  TRADE_PUSHES,
  TRADE_ROOM_PREFIX,
  postgresTradeParties,
  pushHandler,
  tradeRoomAuthorizer,
} from './infrastructure/realtime.js';
import { claimTradeInvitation, expireTradeInvitation } from './services/proposal.service.js';

export interface TradesModuleOptions {
  db: Db;
  redis: Redis;
  config: AppConfig;
  logger: Logger;
  /**
   * The socket gateway, taken as a port rather than reached for (the trust module's precedent). It
   * arrives from `createModules`, which builds the socket module first. Pushes are decided in the
   * worker and cross to whichever API instance holds a socket over the Redis adapter.
   */
  gateway: SocketGateway;
  /**
   * Signed avatar URLs for a batch of users, from identity's `resolveAvatarUrls` over the files module
   * (wired by `createModules`). Absent in a process with no files wiring, where every avatar is null.
   */
  avatarUrls?: (userIds: string[]) => Promise<Map<string, string | null>>;
}

export function buildTradeDeps({
  db,
  redis,
  config,
  logger,
  avatarUrls,
}: Omit<TradesModuleOptions, 'gateway'>): TradeDeps {
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
    displays: postgresCounterpartyDisplays(avatarUrls ?? (() => Promise.resolve(new Map()))),
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
    proofFiles: (tx, ids) => deps.proofFiles(tx, ids),
    standards: deps.standards,
    logistics: noLogisticsCompanies,
    park: noParkCoverage,
    now: () => new Date(),
  };
}

/** Inspection's ports. The one seam is the dispute check (T-080), which answers no until that exists. */
export function buildInspectionDeps(deps: TradeDeps): InspectionDeps {
  return { db: deps.db, disputes: noDisputes, now: () => new Date() };
}

/** Evidence's ports: the files module's upload progress and its case-grant. */
export function buildEvidenceDeps(deps: TradeDeps): EvidenceDeps {
  return {
    db: deps.db,
    proofFiles: (tx, ids) => deps.proofFiles(tx, ids),
    fileProgress: postgresFileProgress,
    grantEvidenceAccess: postgresGrantEvidenceAccess(deps.db),
  };
}

export function createTradesModule(options: TradesModuleOptions): KomtruModule {
  const deps = buildTradeDeps(options);
  const fulfilment = buildFulfilmentDeps(deps);
  const inspection = buildInspectionDeps(deps);
  const evidence = buildEvidenceDeps(deps);

  return defineModule({
    name: 'trades',
    routes: [
      ...tradeRoutes(() => deps),
      ...fulfilmentRoutes(() => fulfilment),
      ...cancellationRoutes(() => fulfilment),
      ...inspectionRoutes(() => inspection),
      ...evidenceRoutes(() => evidence),
      ...viewerRoutes(() => deps),
    ],
    schedules: [
      deliveryDeadlineJob(() => fulfilment),
      inspectionDeadlineJob(() => inspection),
      graceDeadlineJob(() => inspection),
      inspectionReminderJob(() => inspection),
    ],

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
      // F-024: the ledger has escrowed the buyer's payment: PENDING_PAYMENT -> FUNDED, in the event's own
      // transaction. Money the trade will not take is recorded for review inside fundTrade (an outbox event and
      // an activity row, committed with the claim) and logged here too; a retry cannot fund a cancelled trade.
      ctx.events.subscribe({
        name: 'trades.on-escrow-funded',
        event: ledgerEscrowFundedEvent,
        handler: async ({ payload }, tx) => {
          const outcome = await fundTrade(tx, payload);
          if (outcome !== 'FUNDED' && outcome !== 'ALREADY_FUNDED') {
            ctx.logger.warn(
              { tradeId: payload.tradeId, paymentAttemptId: payload.paymentAttemptId, outcome },
              'trades: escrow funding not applied; held for review',
            );
          }
        },
      });
      // The ledger has released the escrow: COMPLETED -> SETTLED. It runs in the event's own
      // transaction, so the transition and the claim on the event commit together. A trade that is
      // not COMPLETED (a dispute-split release is T-080's) is reported, not retried: a retry cannot fix it.
      ctx.events.subscribe({
        name: 'trades.on-escrow-released',
        event: ledgerEscrowReleasedEvent,
        handler: async ({ payload }, tx) => {
          const outcome = await settleTrade(tx, {
            tradeId: payload.tradeId,
            journalEntryId: payload.journalEntryId,
          });
          if (outcome === 'IGNORED' || outcome === 'UNKNOWN_TRADE') {
            ctx.logger.warn({ tradeId: payload.tradeId, outcome }, 'trades: escrow release not applied');
          }
        },
      });
      // T-066: the ledger has decided the buyer's refund: FUNDED -> CANCELLED_REFUNDED, in the event's own
      // transaction. A trade that is no longer FUNDED is reported, not retried: a retry cannot fix it, and
      // the money is already accounted for in the ledger, which is where T-076 finds it.
      ctx.events.subscribe({
        name: 'trades.on-escrow-refunded',
        event: ledgerEscrowRefundedEvent,
        handler: async ({ payload }, tx) => {
          const outcome = await refundTrade(tx, payload);
          if (outcome === 'IGNORED' || outcome === 'UNKNOWN_TRADE') {
            ctx.logger.warn(
              { tradeId: payload.tradeId, refundId: payload.refundId, scope: payload.scope, outcome },
              'trades: escrow refund not applied to the trade',
            );
          }
        },
      });
      // T-066: a buyer's cancellation request still waiting when the trade leaves FUNDED some other way
      // (shipped, or refunded for an overdue delivery) can no longer be answered.
      ctx.events.subscribe({
        name: 'trades.lapse-cancellation-request',
        event: tradeStateChangedEvent,
        handler: async ({ payload }, tx) => {
          if (payload.from !== 'FUNDED') return;
          await lapsePendingCancellation(tx, payload.tradeId);
        },
      });
      // T-068: who may join `trade:<code>`, and a push for every change a workspace tab shows. The
      // authorizer is registered here, at start, so a process that never starts the module (a
      // migration run) never claims the prefix; a second claim is a boot failure by design.
      options.gateway.registerRoomAuthorizer(
        TRADE_ROOM_PREFIX,
        tradeRoomAuthorizer({ parties: postgresTradeParties(options.db) }),
      );
      for (const push of TRADE_PUSHES) {
        ctx.events.subscribe({
          name: push.subscriber,
          event: push.event,
          handler: pushHandler(options.gateway, ctx.logger, push),
        });
      }
      return Promise.resolve();
    },
  });
}
