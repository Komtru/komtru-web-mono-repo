// The module registry: every domain module, in start order. Each later ticket adds its module here,
// importing only that module's index.ts.
//
// It is a function rather than a constant array because a module may need the process's own
// connections and configuration before it exists at all: identity has to build a token signer and an
// epoch cache before it can answer "who is calling".
import { and, eq, notInArray, or } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../db/index.js';
import type { Logger } from '../platform/logger.js';
import type { KomtruModule, SeedableModule } from '../platform/module.js';
import { casesModule } from './cases/index.js';
import { configModule } from './config/index.js';
import { filesModule, filesSeed, requestTombstone, tombstoneByUploader } from './files/index.js';
import { geoModule, getCitiesByIds } from './geo/index.js';
import { createIdentityAuth, identityModule, identitySeed, resolvePrincipal } from './identity/index.js';
import { ledgerModule } from './ledger/index.js';
import { notifyModule } from './notify/index.js';
import { createSocketModule } from './socket/index.js';
import { TERMINAL_STATUSES, createTradesModule, trades } from './trades/index.js';
import { createTrustModule } from './trust/index.js';

export interface ProcessDeps {
  db: Db;
  redis: Redis;
  config: AppConfig;
  logger: Logger;
}

export type ModuleBuilder = (deps: ProcessDeps) => KomtruModule[];

// config first: it holds the fee schedule, which is read and validated at import, and everything
// that posts money reads a snapshot taken from it. identity next, because its RBAC catalogue and
// reserved namespace are what every other module's permissions are checked against. files after
// identity, because every one of its routes is scope-checked against the actor identity resolves.
// trust after files, because a liveness selfie is a file record it resolves through M20's barrel.
// notify after those: it only subscribes to what the others publish.
/**
 * CA1/CA2's question, answered from trades because identity cannot ask it (trades imports identity).
 * Any trade the user is a party to, or started, that has not reached a terminal state: the strictest
 * reading, so a closure never strands a counterparty or money in escrow (plan, owner decision 3).
 */
const hasActiveTrades = async (db: Pick<Db, 'select'>, userId: string): Promise<boolean> => {
  const rows = await db
    .select({ id: trades.id })
    .from(trades)
    .where(
      and(
        or(
          eq(trades.buyerUserId, userId),
          eq(trades.sellerUserId, userId),
          eq(trades.initiatorUserId, userId),
        ),
        notInArray(trades.status, [...TERMINAL_STATUSES]),
      ),
    )
    .limit(1);
  return rows.length > 0;
};

export const createModules: ModuleBuilder = (deps) => {
  const auth = createIdentityAuth({
    ...deps,
    cities: getCitiesByIds,
    hasActiveTrades,
    // M1 §15 step 6: the avatar first (named, so it is tombstoned even if the record names another
    // uploader), then every other upload, through files, after the commit.
    // TODO(T-104): a failure here is only logged by identity. The committed
    // `identity.account.anonymised` event is the retry hook; compliance's DSR fulfilment should
    // re-drive this for any user whose files are still ACTIVE.
    tombstoneUserFiles: async ({ userId, avatarFileId, reason }) => {
      const done: string[] = [];
      if (avatarFileId) {
        // A soft reference: the record may be gone already, which is not a failure of erasure.
        const tombstoned = await requestTombstone(deps.db, { fileId: avatarFileId, reason }).then(
          () => true,
          () => false,
        );
        if (tombstoned) done.push(avatarFileId);
      }
      return [...done, ...(await tombstoneByUploader(deps.db, { uploaderUserId: userId, reason }))];
    },
  });
  // Built before the array so trust can be handed its gateway, and placed LAST in the array so the
  // start order is unchanged: it produces nothing of its own, it only pushes what the others
  // produce. It takes identity's own resolver so a socket's handshake and its re-validation sweep
  // reach the same verdict, by the same query, as an HTTP request carrying the same token.
  const socket = createSocketModule({
    config: deps.config,
    logger: deps.logger,
    authenticate: (token) =>
      resolvePrincipal({ db: deps.db, signer: auth.signer, epochs: auth.epochs, logger: deps.logger }, token),
  });

  return [
    configModule,
    identityModule(auth),
    filesModule,
    // Takes the gateway rather than reaching for it: a verification outcome is decided in the worker
    // and pushed from there, and the Redis adapter carries it to whichever API instance holds the
    // user's socket.
    createTrustModule({ gateway: socket.gateway }),
    // After identity, whose audit log every staff change to the catalog writes.
    geoModule,
    ledgerModule,
    // After identity (party lookup, invitations, addresses), config (standards, fees) and files
    // (proof media), which it reads through their barrels.
    createTradesModule(deps),
    // After identity, whose audit log and role grants every staff change to a case reads and writes.
    casesModule,
    notifyModule,
    socket,
  ];
};

// The same registry, in the same order, reduced to what `pnpm db:migrate` can supply: a database.
// Seeding must not need Redis or a signing key, so this list holds the seed hooks rather than the
// built modules.
export const moduleSeeds: SeedableModule[] = [
  configModule,
  identitySeed,
  filesSeed,
  geoModule,
  ledgerModule,
  notifyModule,
];
