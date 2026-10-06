// A read that works inside a caller's transaction or outside one. Mirrors ledger's Reader: a service
// that may be called from a request handler AND from inside another service's transaction should not
// have to care which, and passing `Db` where a `Tx` is open would silently read outside it.
import type { Db } from '../../../../db/index.js';
import type { Tx } from '../../../../platform/events/publish.js';

export type Reader = Db | Tx;
