// The config module's public surface: the only way any other module reads a fee (design §6.5).
// Enforced twice over — by eslint-rules/module-boundaries.mjs, and by the repo-level fee guard in
// scripts/test/support/fee-guard.ts, which scans the source so a disabled rule is not the only line
// of defence.
import { defineModule } from '../../platform/module.js';
import { feesRoute } from './routes.js';

export { findFeesFile, getFeeSchedule, loadFeeSchedule, snapshotFees } from './fees.js';
export { feeScheduleResponseSchema } from './routes.js';

export const configModule = defineModule({ name: 'config', routes: [feesRoute] });
