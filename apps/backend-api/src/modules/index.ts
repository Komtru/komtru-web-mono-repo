// The module registry: every domain module, in start order. Each later ticket adds its module here,
// importing only that module's index.ts.
//
// It is a function rather than a constant array because a module may need the process's own
// connections and configuration before it exists at all: identity has to build a token signer and an
// epoch cache before it can answer "who is calling".
import type { Redis } from 'ioredis';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../db/index.js';
import type { Logger } from '../platform/logger.js';
import type { KomtruModule, SeedableModule } from '../platform/module.js';
import { configModule } from './config/index.js';
import { createIdentityAuth, identityModule, identitySeed } from './identity/index.js';
import { ledgerModule } from './ledger/index.js';
import { notifyModule } from './notify/index.js';

export interface ProcessDeps {
  db: Db;
  redis: Redis;
  config: AppConfig;
  logger: Logger;
}

export type ModuleBuilder = (deps: ProcessDeps) => KomtruModule[];

// config first: it holds the fee schedule, which is read and validated at import, and everything
// that posts money reads a snapshot taken from it. identity next, because its RBAC catalogue and
// reserved namespace are what every other module's permissions are checked against. notify last:
// it only subscribes to what the others publish.
export const createModules: ModuleBuilder = (deps) => [
  configModule,
  identityModule(createIdentityAuth(deps)),
  ledgerModule,
  notifyModule,
];

// The same registry, in the same order, reduced to what `pnpm db:migrate` can supply: a database.
// Seeding must not need Redis or a signing key, so this list holds the seed hooks rather than the
// built modules.
export const moduleSeeds: SeedableModule[] = [configModule, identitySeed, ledgerModule, notifyModule];
