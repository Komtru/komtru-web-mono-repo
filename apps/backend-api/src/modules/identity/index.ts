// The identity module's public surface. Other modules may import these and nothing else from here;
// the komtru/module-boundaries rule makes this the only way in.
import type { Db } from '../../db/index.js';
import { defineModule } from '../../platform/module.js';
import { usernameRoutes } from './http/username.controller.js';
import { seedIdentityCatalogue } from './infrastructure/postgres/seed.js';
import type { UsernameServiceDeps } from './services/username.service.js';

export * from './infrastructure/postgres/schema/index.js';
export * from './domain/events.js';
export * from './domain/rbac/catalog.js';
export * from './domain/username/policy.js';
export * from './domain/username/reserved.js';
export * from './domain/username/skeleton.js';
export * from './domain/username/suggest.js';
export * from './services/username.service.js';
export { seedIdentityCatalogue } from './infrastructure/postgres/seed.js';

/**
 * The runtime pool, handed over by `start()`.
 *
 * `routes` is a static property of the module — the registry reads it when it mounts — while the db
 * only exists once the process has one. So the route handlers close over this holder rather than
 * over a pool, and reading it before `start()` throws instead of quietly answering 500 from an
 * undefined connection. T-031 is introducing the principal resolver through the same `start()`
 * context and may well replace this with a shared shape; one holder is cheap to delete.
 */
let runtimeDb: Db | undefined;

const deps: UsernameServiceDeps = {
  get db(): Db {
    if (!runtimeDb) throw new Error('identity routes were used before the module started');
    return runtimeDb;
  },
};

export const identityModule = defineModule({
  name: 'identity',
  routes: usernameRoutes(deps),
  // The RBAC catalogue and the reserved namespace are reference data, not schema: they are
  // reconciled from code on every `pnpm db:migrate` rather than frozen into a migration (seed.ts).
  seed: async (db) => void (await seedIdentityCatalogue(db)),
  start: (ctx) => {
    runtimeDb = ctx.db;
    return Promise.resolve();
  },
});
