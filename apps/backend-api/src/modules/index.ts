// The module registry: every domain module, in start order. Each later ticket adds its module here,
// importing only that module's index.ts.
import type { KomtruModule } from '../platform/module.js';
import { identityModule } from './identity/index.js';

export const modules: KomtruModule[] = [identityModule];
