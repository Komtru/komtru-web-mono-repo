// `trades.inspection-deadlines`: auto-completes a trade whose inspection window elapsed (AR1), unless
// a hold or a dispute exists. Every five minutes is the resolution a deadline is promised to; the work
// is in `sweepInspectionDeadlines`, which is idempotent, so a second worker, a retried occurrence or an
// occurrence that ran twice does no harm. Registered by the module and run only by the worker process.
import type { ScheduledJob } from '../../../platform/scheduler/registry.js';
import { sweepInspectionDeadlines } from '../services/inspectionDeadline.service.js';
import type { InspectionDeps } from '../services/inspectionPorts.js';

export const inspectionDeadlineJob = (deps: () => InspectionDeps): ScheduledJob => ({
  name: 'trades.inspection-deadlines',
  cron: '*/5 * * * *',
  description: 'Complete trades whose inspection window has elapsed, unless a hold or dispute exists',
  handler: () => sweepInspectionDeadlines(deps()),
});
