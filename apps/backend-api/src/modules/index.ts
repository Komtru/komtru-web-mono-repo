// The module registry: every domain module, in start order. Each later ticket adds its module here,
// importing only that module's index.ts.
import type { KomtruModule } from '../platform/module.js';
import { configModule } from './config/index.js';

export const modules: KomtruModule[] = [configModule];
