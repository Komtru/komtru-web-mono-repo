// The module registry: every domain module, in start order. Each later ticket adds its module here,
// importing only that module's index.ts.
import type { KomtruModule } from '../platform/module.js';
import { configModule } from './config/index.js';
import { identityModule } from './identity/index.js';
import { ledgerModule } from './ledger/index.js';

// config first: it holds the fee schedule, which is read and validated at import, and everything
// that posts money reads a snapshot taken from it. identity next, because its RBAC catalogue and
// reserved namespace are what every other module's permissions are checked against.
export const modules: KomtruModule[] = [configModule, identityModule, ledgerModule];
