// The logistics module (T-085, T-086): companies, their POCs, and the portal's team routes.
//
// The composition root. Its connections and keys are bound in start(), never at import: the platform
// reads `routes` off a module before start runs, so a handler reaches for them only when called.
import type { Db } from '../../db/index.js';
import { createEncryption } from '../../platform/crypto/encryption.js';
import { createHmacHasher } from '../../platform/crypto/hmac.js';
import { defineModule, type KomtruModule, type ModuleContext } from '../../platform/module.js';
import { logisticsRoutes } from './http/routes.js';
import { subscribeToIdentity } from './infrastructure/identityListener.js';
import type { LogisticsCrypto } from './services/member.service.js';

interface Runtime {
  db: Db;
  crypto: LogisticsCrypto;
}

export function createLogisticsModule(): KomtruModule {
  let runtime: Runtime | undefined;
  const need = (): Runtime => {
    if (!runtime) throw new Error('logistics module: a request or job ran before start()');
    return runtime;
  };

  return defineModule({
    name: 'logistics',

    routes: logisticsRoutes({ db: () => need().db, crypto: () => need().crypto }),

    start: (ctx: ModuleContext) => {
      // Both fail here, naming their variable, rather than at the first invitation: an invitation's
      // address can only be stored hashed and sealed.
      const pepper = ctx.config.identity.hmacPepper;
      if (!pepper) throw new Error('IDENTITY_HMAC_PEPPER is required to start the logistics module');
      runtime = {
        db: ctx.db,
        crypto: { hasher: createHmacHasher(pepper), encryption: createEncryption(ctx.config) },
      };
      subscribeToIdentity(ctx.events, () => need().crypto.hasher);
      return Promise.resolve();
    },

    stop: () => {
      runtime = undefined;
      return Promise.resolve();
    },
  });
}

export const logisticsModule = createLogisticsModule();
