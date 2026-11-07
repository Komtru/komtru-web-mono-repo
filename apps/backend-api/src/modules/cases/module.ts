// The cases module (T-107): the universal case index, the work queue and the advisory. Owning
// modules (disputes, trust, park, risk, ...) keep their records and register into this index.
import type { Db } from '../../db/index.js';
import { defineModule, type KomtruModule, type ModuleContext } from '../../platform/module.js';
import { ruleBasedAdvisory } from './domain/advisory.js';
import { caseRoutes } from './http/routes.js';

export function createCasesModule(): KomtruModule {
  // Resolved in start(): the platform reads `routes` before start runs, so a handler can only reach
  // for the process's connections when it is called (the shape geo, config and files use).
  let db: Db | undefined;
  const need = (): Db => {
    if (!db) throw new Error('cases module: a request ran before start()');
    return db;
  };

  return defineModule({
    name: 'cases',
    // v1 advisory is rules (Q9 default). An LLM-backed provider replaces it here, nowhere else.
    routes: caseRoutes({ db: need, advisory: () => ruleBasedAdvisory }),

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
