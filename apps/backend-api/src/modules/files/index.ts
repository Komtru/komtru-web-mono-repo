// File & Evidence Management (M20) — the ONLY public surface of this module.
//
// M20 is the one module in the set with no domain knowledge of its own: it does not know what a
// "dispute evidence photo" proves, only that something referenced it and who may see it (§1's
// boundary note). What is exported reflects that — a way to get bytes in, a way to get an authorized
// URL out, and the hooks the modules above it need. `komtru/module-boundaries` makes this the only
// way in.
//
// What is deliberately NOT exported, and must not be:
//
//  - **anything that returns a URL without an access decision.** There is exactly one path from a
//    file id to bytes, and it runs `decideAccess` and writes the audit row on the way. A convenience
//    `signUrl(fileId)` would be the second path, and the second path is the one that is wrong after
//    somebody changes the policy.
//  - **Cloudinary credentials, or anything that resolves them.** `api_secret` never leaves
//    `infrastructure/providers/`.
//  - **the storage-account tables' write side.** A consumer passes a `category` and never learns
//    which of the five accounts holds the bytes (D1); rotation and registration are ops surfaces,
//    reachable over HTTP and not by another module.

// The schema other modules read, and the events they react to.
export * from './infrastructure/postgres/schema/index.js';
export * from './domain/events.js';

// The registry entry and its seed.
export { createFilesModule, filesModule, filesSeed } from './module.js';

/**
 * The upload API every consuming module uses (D1).
 *
 * `createUploadTicket` takes `captureHubId` because the Park ticket (T-092) resolves the hub from the
 * agent's own assignments and passes it here — the HTTP endpoint has no field for one, because a
 * client-supplied hub id would be a custody claim nobody checked.
 */
export {
  createUploadTicket,
  requestFinalize,
  requestTombstone,
  tombstoneByUploader,
  findFile,
  findServableFile,
  type UploadTicket,
  type UploadTicketRequest,
  type TombstoneInput,
} from './services/file.service.js';

/**
 * The single authorized path from a file id to bytes.
 *
 * Takes a subject rather than reading one from anywhere, so a caller cannot accidentally resolve a
 * file "as the system" — there is no such principal, and the audit row would have nobody in it.
 */
export { retrieveFile, subjectFrom, type RetrievalResult } from './services/access.service.js';

/**
 * Case-scoped access (D2's PRIVATE_CASE).
 *
 * A dispute grants its buyer and seller by user id and its reviewer by role; a ticket grants its
 * reporter. The rule for WHO belongs on a case is the consuming module's — M20 only records it.
 */
export {
  grantAccess,
  revokeGrant,
  listGrants,
  listAccessLog,
  type GrantInput,
} from './services/access.service.js';

/**
 * Domain tables other modules legitimately read, exported as DATA rather than behaviour: a module
 * deciding which visibility class to request needs to know what its category permits, and
 * reconstructing that table elsewhere would guarantee it drifts.
 */
export {
  POOL_BY_CATEGORY,
  AUDITED_CATEGORIES,
  ALLOWED_CONTENT_TYPES,
  isAuditedCategory,
} from './domain/pools.js';
export { ALLOWED_VISIBILITY, OWNING_MODULE, checkUploadRequest } from './domain/upload-policy.js';
export { decideAccess, type AccessSubject, type AccessTarget, type AccessDecision } from './domain/access.js';
export { PoolExhaustedError, StorageAccountUnconfiguredError } from './domain/errors.js';
