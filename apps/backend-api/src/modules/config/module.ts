// The config module: the public fee schedule route (T-047), the M17 admin routes, the typed settings
// accessor with its Redis cache, and the seed of every default.
import type { Db } from '../../db/index.js';
import { defineModule, type KomtruModule, type ModuleContext } from '../../platform/module.js';
import { featureFlagToggled, settingChanged } from './domain/events.js';
import { configAdminRoutes } from './http/admin.routes.js';
import { feesRoute } from './routes.js';
import { createConfigAccessor, type ConfigAccessor } from './services/accessor.js';
import { seedSettings } from './services/settings.service.js';

interface ConfigRuntime {
  db: Db;
  accessor: ConfigAccessor;
}

export function createConfigModule(): KomtruModule {
  // Resolved in start(): the platform reads `routes` before start runs, so a handler can only reach
  // for the process's connections when it is called (the same shape files uses).
  let runtime: ConfigRuntime | undefined;
  const need = (): ConfigRuntime => {
    if (!runtime) throw new Error('config module: a request ran before start()');
    return runtime;
  };

  return defineModule({
    name: 'config',
    routes: [feesRoute, ...configAdminRoutes({ db: () => need().db, accessor: () => need().accessor })],
    // Reference data, not schema: M17 section 4's defaults. Insert-only, so an operator's edit survives.
    seed: (db) => seedSettings(db),

    start: (ctx: ModuleContext) => {
      const accessor = createConfigAccessor(ctx.db, ctx.redis, ctx.logger);
      runtime = { db: ctx.db, accessor };

      // The write path already drops the key on the instance that took the request. These cover every
      // other instance and any writer that is not this module's own route, and run in the worker, which
      // shares the API's Redis.
      ctx.events.subscribe({
        name: 'config.on-setting-changed',
        event: settingChanged,
        handler: async (envelope) => {
          await accessor.invalidateSetting(envelope.payload.namespace, envelope.payload.key);
        },
      });
      ctx.events.subscribe({
        name: 'config.on-feature-flag-toggled',
        event: featureFlagToggled,
        handler: async (envelope) => {
          await accessor.invalidateFlag(envelope.payload.flagCode);
        },
      });
      return Promise.resolve();
    },

    stop: () => {
      runtime = undefined;
      return Promise.resolve();
    },
  });
}
