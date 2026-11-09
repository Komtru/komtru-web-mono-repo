// `trades.grace-deadlines`: converts an unconfirmed delivery whose grace period elapsed into a
// confirmed one and starts the inspection window (M7 section 6). Idempotent, like its siblings.
import type { ScheduledJob } from '../../../platform/scheduler/registry.js';
import { sweepGraceDeadlines } from '../services/inspectionDeadline.service.js';
import type { InspectionDeps } from '../services/inspectionPorts.js';

export const graceDeadlineJob = (deps: () => InspectionDeps): ScheduledJob => ({
  name: 'trades.grace-deadlines',
  cron: '*/5 * * * *',
  description: 'Move unconfirmed deliveries to inspection once the buyer grace period has elapsed',
  handler: () => sweepGraceDeadlines(deps()),
});
