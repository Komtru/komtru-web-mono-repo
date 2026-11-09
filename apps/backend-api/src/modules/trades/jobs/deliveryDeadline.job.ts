// `trades.delivery-deadlines`: fires overdue delivery deadlines (DE3, DE4). Every five minutes is
// the resolution a deadline is promised to; the work is in `sweepDeliveryDeadlines`, which is
// idempotent, so a second worker, a retried occurrence or an occurrence that ran twice does no
// harm. Registered by the module and run only by the worker process.
import type { ScheduledJob } from '../../../platform/scheduler/registry.js';
import type { FulfilmentDeps } from '../services/fulfilmentPorts.js';
import { sweepDeliveryDeadlines } from '../services/deadline.service.js';

export const deliveryDeadlineJob = (deps: () => Pick<FulfilmentDeps, 'db' | 'now'>): ScheduledJob => ({
  name: 'trades.delivery-deadlines',
  cron: '*/5 * * * *',
  description: 'Request a refund for funded trades past their delivery deadline with nothing shipped',
  handler: () => sweepDeliveryDeadlines(deps()),
});
