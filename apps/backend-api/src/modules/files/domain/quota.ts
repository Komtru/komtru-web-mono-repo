// M20 §5's thresholds, as a pure function of the credit figure and the configured limits.
import type { StorageAccountStatus } from '../infrastructure/postgres/schema/enums.js';

export interface QuotaThresholds {
  nearPct: number;
  disabledPct: number;
}

/**
 * The whole of the usage-sync job's decision.
 *
 * Thresholds are placeholders in the spec's own words — "v1, deliberately simple, tune once real
 * volume exists". What matters structurally is that this job is the only writer of
 * `storage_accounts.status`, never application code reacting to a failed upload.
 */
export const statusForCredits = (
  creditsUsedPct: number,
  thresholds: QuotaThresholds,
): StorageAccountStatus => {
  if (creditsUsedPct >= thresholds.disabledPct) return 'DISABLED';
  if (creditsUsedPct >= thresholds.nearPct) return 'NEAR_QUOTA';

  // Recovery is automatic. Cloudinary's credit meter resets monthly, so an account that tripped a
  // threshold in the last week of the month must come back on its own — an operator having to
  // remember to re-enable five accounts every month is a runbook nobody will follow.
  return 'ACTIVE';
};
