// `trades.inspection-reminders`: tells a buyer, once, that their inspection window is closing (T-068).
// Every fifteen minutes is plenty for a lead measured in hours. Idempotent: `sweepInspectionReminders`
// claims each reminder with a guarded UPDATE, so a second worker or a rerun sends nothing twice.
import type { ScheduledJob } from '../../../platform/scheduler/registry.js';
import { sweepInspectionReminders } from '../services/inspectionReminder.service.js';
import type { InspectionDeps } from '../services/inspectionPorts.js';

export const inspectionReminderJob = (deps: () => InspectionDeps): ScheduledJob => ({
  name: 'trades.inspection-reminders',
  cron: '*/15 * * * *',
  description: 'Remind buyers, once, that their inspection window is about to close',
  handler: () => sweepInspectionReminders(deps()),
});
