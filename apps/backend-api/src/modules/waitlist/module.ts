// The launch waitlist: one public route, one table, no jobs and no events.
import type { Db } from '../../db/index.js';
import { defineModule, type KomtruModule, type ModuleContext } from '../../platform/module.js';
import { waitlistRoutes } from './http/routes.js';

export function createWaitlistModule(): KomtruModule {
  // Resolved in start(), like geo's: the platform reads `routes` before start runs, so a handler
  // reaches for the pool only when it is called.
  let db: Db | undefined;
  const need = (): Db => {
    if (!db) throw new Error('waitlist module: a request ran before start()');
    return db;
  };

  return defineModule({
    name: 'waitlist',
    routes: waitlistRoutes({ db: need }),
    start: (ctx: ModuleContext) => {
      db = ctx.db;
      return Promise.resolve();
    },
    stop: () => {
      db = undefined;
      return Promise.resolve();
    },
  });
}
