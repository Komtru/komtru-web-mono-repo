// The geo module: the location catalog (T-046, design 7.8). Public dropdown routes, the consumer's
// "My city isn't listed", the staff routes behind `geo.manage`, the Redis read cache with its
// invalidation, and the seed of states and cities.
import type { Db } from '../../db/index.js';
import { defineModule, type KomtruModule, type ModuleContext } from '../../platform/module.js';
import { catalogChanged } from './domain/events.js';
import { geoAdminRoutes } from './http/admin.routes.js';
import { geoPublicRoutes } from './http/public.routes.js';
import { createGeoCache, type GeoCache } from './infrastructure/redis/cache.js';
import { seedLocations } from './services/seed.service.js';

interface GeoRuntime {
  db: Db;
  cache: GeoCache;
}

export function createGeoModule(): KomtruModule {
  // Resolved in start(): the platform reads `routes` before start runs, so a handler can only reach
  // for the process's connections when it is called (the same shape config and files use).
  let runtime: GeoRuntime | undefined;
  const need = (): GeoRuntime => {
    if (!runtime) throw new Error('geo module: a request ran before start()');
    return runtime;
  };
  const httpDeps = { db: () => need().db, cache: () => need().cache };

  return defineModule({
    name: 'geo',
    routes: [...geoPublicRoutes(httpDeps), ...geoAdminRoutes(httpDeps)],
    // Reference data, not schema: the reviewed state and city list. Insert-only and idempotent.
    seed: seedLocations,

    start: (ctx: ModuleContext) => {
      const cache = createGeoCache(ctx.redis, ctx.logger);
      runtime = { db: ctx.db, cache };

      // The write path already bumped the version on the instance that took the request. This covers
      // every other instance and any writer that is not this module's own route.
      ctx.events.subscribe({
        name: 'geo.on-catalog-changed',
        event: catalogChanged,
        handler: async () => {
          await cache.purge();
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
