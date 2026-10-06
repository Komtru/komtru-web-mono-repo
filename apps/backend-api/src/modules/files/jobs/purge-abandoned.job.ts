// Reclaims upload tickets that were issued and never used.
//
// Hygiene rather than a correctness fix — abandoned rows are invisible to every read path — which is
// why it tombstones with an explicit reason rather than deleting: D4 has no exception for "we think
// nobody referenced this one".
import type { FileJobDeps } from './deps.js';

export async function runPurgeAbandoned(deps: FileJobDeps, firedAt: Date): Promise<{ purged: number }> {
  // `firedAt` is the occurrence's SCHEDULED time, not `new Date()`: a run that starts ten minutes
  // late computes the same cutoff it would have computed on time, so the TTL means one thing.
  const purged = await deps.store.purgeAbandonedUploads(deps.files.uploadTicketTtlMinutes, firedAt);

  if (purged.length > 0) {
    deps.logger.info({ purged: purged.length }, 'files: reclaimed abandoned upload tickets');
  }

  return { purged: purged.length };
}
