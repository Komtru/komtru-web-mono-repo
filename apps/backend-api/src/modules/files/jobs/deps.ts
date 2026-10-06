// What every files job is handed at run time. Resolved in module.ts's start(), never at import: the
// platform reads `queues` and `schedules` off a module BEFORE calling start, so a handler cannot close
// over anything the context carries.
import type { FilesConfig } from '../../../config/env.js';
import type { Logger } from '../../../platform/logger.js';
import type { CloudinaryClient } from '../infrastructure/providers/cloudinary.client.js';
import type { FileJobStore } from './store.js';

export interface FileJobDeps {
  store: FileJobStore;
  /** The only object in the module that reaches Cloudinary, and only jobs/ may hold one (T-028). */
  storage: CloudinaryClient;
  files: FilesConfig;
  logger: Logger;
}
