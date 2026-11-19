// The three dispute clocks, swept every five minutes — the resolution a deadline is promised to.
// The work is in `services/sweeps.ts` and is idempotent, so a second worker, a retried occurrence
// or an occurrence that ran twice does no harm. Registered by the module and run only by the
// worker process.
//
// Three separate schedules rather than one that does all three: each walks a different partial
// index, and a failure in one should not stop the other two. A dispute whose appeal window cannot
// close must not also keep every new case stuck in mediation.
import type { ScheduledJob } from '../../../platform/scheduler/registry.js';
import {
  sweepAppealDeadlines,
  sweepEvidenceDeadlines,
  sweepMediationDeadlines,
  type SweepDeps,
} from '../services/sweeps.js';

export const SWEEP_CRON = '*/5 * * * *';

export const mediationDeadlineJob = (deps: () => SweepDeps): ScheduledJob => ({
  name: 'disputes.mediation-deadlines',
  cron: SWEEP_CRON,
  description: 'Send disputes whose mediation window lapsed into evidence collection',
  handler: () => sweepMediationDeadlines(deps()),
});

export const evidenceDeadlineJob = (deps: () => SweepDeps): ScheduledJob => ({
  name: 'disputes.evidence-deadlines',
  cron: SWEEP_CRON,
  description: 'Close the evidence window on disputes past their deadline and route them to review',
  handler: () => sweepEvidenceDeadlines(deps()),
});

export const appealDeadlineJob = (deps: () => SweepDeps): ScheduledJob => ({
  name: 'disputes.appeal-deadlines',
  cron: SWEEP_CRON,
  description: 'Close decided disputes whose appeal window lapsed with no appeal filed',
  handler: () => sweepAppealDeadlines(deps()),
});
