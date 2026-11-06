// The config module's public surface: the only way any other module reads a fee, a tunable setting or
// a feature flag (design 6.5). Fees are enforced twice over — by eslint-rules/module-boundaries.mjs,
// and by the repo-level fee guard in scripts/test/support/fee-guard.ts, which scans the source so a
// disabled rule is not the only line of defence.
import { createConfigModule } from './module.js';

export {
  feeScheduleSource,
  findFeesFile,
  getFeeSchedule,
  loadFeeSchedule,
  snapshotFees,
  snapshotParkCashFee,
} from './fees.js';
export { feeScheduleResponseSchema } from './routes.js';

// M17 (T-048). A module reads a setting through the accessor, never from the table.
export * from './infrastructure/postgres/schema/index.js';
export * from './domain/events.js';
export { SettingMissingError, SettingTypeError } from './domain/errors.js';
export { SEED_SETTINGS, looksLikeFee, type SettingValue } from './domain/settings.js';
export { createConfigAccessor, type ConfigAccessor } from './services/accessor.js';
export { createConfigModule };

export const configModule = createConfigModule();
