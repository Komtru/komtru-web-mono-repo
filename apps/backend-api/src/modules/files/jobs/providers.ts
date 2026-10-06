// Where the Cloudinary client enters the program, and the only place it does.
//
// `komtru/provider-clients` and test/platform/provider-boundaries.test.ts allow `*.client.ts` to be
// imported from `jobs/` and nowhere else (design §4.4). Keeping the construction here rather than in
// module.ts means the one import of the client sits inside the directory the rule names, and
// module.ts reaches it the way every other job is reached.
import type {
  CloudinaryClient,
  CloudinaryClientOptions,
} from '../infrastructure/providers/cloudinary.client.js';
import { createCloudinaryClient } from '../infrastructure/providers/cloudinary.client.js';

/** The live storage provider. One more line per provider, forever. */
export const storageProvider = (options: CloudinaryClientOptions): CloudinaryClient =>
  createCloudinaryClient(options);

export type {
  CloudinaryClient,
  CloudinaryUsage,
  CloudinaryResource,
  ResourceQuery,
} from '../infrastructure/providers/cloudinary.client.js';
