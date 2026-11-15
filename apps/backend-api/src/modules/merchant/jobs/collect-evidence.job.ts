// The job a submission starts (T-055): ask trust for the CAC lookup, read the evidence back, and keep
// the case's advisory inputs current while the lookup finishes.
//
// It is EVIDENCE collection and nothing else. It never moves the application, never touches the case
// state and never writes a decision: the most it does to the case is `syncCaseFacts`, which the owning
// module is meant to call. A lookup that fails, or cannot run because the applicant has not verified
// their identity yet, is a row in the evidence matrix for a person to weigh.
//
// While the lookup is still pending the job schedules itself again, a bounded number of times, so the
// facts the advisory reads catch up with the lookup without anyone opening the page. The staff detail
// also refreshes them on view, so a missed run costs freshness and never correctness.
import { eq } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import type { Logger } from '../../../platform/logger.js';
import { COLLECT_EVIDENCE_QUEUE } from '../domain/queues.js';
import { merchantApplications } from '../infrastructure/postgres/schema/applications.js';
import { refreshCaseFacts } from '../services/evidence.service.js';
import type { EvidenceJob, MerchantPorts } from '../services/ports.js';

/** Re-checks at 30 seconds, 5 minutes and an hour. A lookup slower than that is a person's to chase. */
export const RECHECK_DELAYS_MS = [30_000, 300_000, 3_600_000] as const;

export { COLLECT_EVIDENCE_QUEUE };

export interface CollectEvidenceDeps {
  db: Db;
  ports: MerchantPorts;
  logger: Logger;
}

export async function runCollectEvidence(deps: CollectEvidenceDeps, job: EvidenceJob): Promise<void> {
  const [app] = await deps.db
    .select()
    .from(merchantApplications)
    .where(eq(merchantApplications.id, job.applicationId))
    .limit(1);
  // An application a person has already decided, or one that was withdrawn to a draft, needs nothing.
  if (!app || (app.status !== 'SUBMITTED' && app.status !== 'IN_REVIEW')) return;

  if (job.attempt === 0 && app.cacRcNumber) {
    const requested = await deps.ports.requestCacLookup({ userId: app.userId, rcNumber: app.cacRcNumber });
    deps.logger.info(
      { applicationId: app.id, outcome: requested.outcome },
      'merchant: asked trust for the CAC lookup',
    );
  }

  const { matrix } = await refreshCaseFacts(deps.db, deps.ports, app);
  const waiting = matrix.cacLookup.state === 'PENDING' || matrix.cacLookup.state === 'NOT_RUN';
  const delay = RECHECK_DELAYS_MS[job.attempt];
  if (waiting && delay !== undefined) {
    await deps.ports.enqueueEvidence({ applicationId: app.id, attempt: job.attempt + 1 }, delay);
  }
}
