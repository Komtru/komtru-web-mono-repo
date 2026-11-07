// The SLA clock (T-107). Hours by type are product defaults recorded in the T-107 plan under "Owner
// decisions pending"; they live here, in code, until the configuration module holds them.
import type { CaseState, CaseType } from './types.js';
import { FINISHED_STATES } from './types.js';

export const SLA_HOURS: Record<CaseType, number> = {
  DISPUTE: 48,
  KYB: 72,
  MERCHANT_APPLICATION: 72,
  IDENTITY: 24,
  FRAUD: 24,
  CUSTODY: 48,
  PAYMENT_EXCEPTION: 24,
  TRADE_PROPOSAL: 24,
  PARK_HUB_APPLICATION: 120,
};

/** A case is "at risk" in the last quarter of its window, or once it has breached. */
export const AT_RISK_FRACTION = 0.25;

const HOUR_MS = 3_600_000;

export const slaDueAt = (startedAt: Date, slaHours: number): Date =>
  new Date(startedAt.getTime() + slaHours * HOUR_MS);

export type SlaStatus = 'ON_TRACK' | 'AT_RISK' | 'BREACHED' | 'STOPPED';

export interface SlaView {
  status: SlaStatus;
  dueAt: Date;
  /** Negative once breached. Null when the clock has stopped (the case is decided or closed). */
  remainingMinutes: number | null;
}

export function slaView(input: { state: CaseState; dueAt: Date; slaHours: number; now: Date }): SlaView {
  if (FINISHED_STATES.includes(input.state)) {
    return { status: 'STOPPED', dueAt: input.dueAt, remainingMinutes: null };
  }
  const remainingMs = input.dueAt.getTime() - input.now.getTime();
  const remainingMinutes = Math.floor(remainingMs / 60_000);
  let status: SlaStatus = 'ON_TRACK';
  if (remainingMs <= 0) status = 'BREACHED';
  else if (remainingMs <= input.slaHours * HOUR_MS * AT_RISK_FRACTION) status = 'AT_RISK';
  return { status, dueAt: input.dueAt, remainingMinutes };
}

/** The same threshold as `slaView`, in seconds, for the SQL that picks the "SLA at risk" tab. */
export const atRiskSeconds = (slaHours: number): number => slaHours * 3600 * AT_RISK_FRACTION;
