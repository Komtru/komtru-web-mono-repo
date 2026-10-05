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
import type { KomtruModule } from '../platform/module.js';
import { createIdentityAuth, identityModule } from './identity/index.js';

export interface ProcessDeps {
  db: Db;
  redis: Redis;
  config: AppConfig;
  logger: Logger;
}

export type ModuleBuilder = (deps: ProcessDeps) => KomtruModule[];

export const createModules: ModuleBuilder = (deps) => [identityModule(createIdentityAuth(deps))];
