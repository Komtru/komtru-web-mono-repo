// How a case is written on screen: the area it belongs to, the clock on it, plain words for codes.
import type { CasePriority, CaseState, CaseType, CaseView } from '@komtru/api-client';
import type { ChipTone } from '@komtru/ui-kit';

export type Area = 'People' | 'Proposals' | 'Money' | 'Custody' | 'Cases' | 'Risk';

export const AREAS: readonly Area[] = ['People', 'Proposals', 'Money', 'Custody', 'Cases', 'Risk'];

const AREA_BY_TYPE: Record<CaseType, Area> = {
  DISPUTE: 'Cases',
  FRAUD: 'Risk',
  KYB: 'People',
  IDENTITY: 'People',
  MERCHANT_APPLICATION: 'People',
  PARK_HUB_APPLICATION: 'People',
  TRADE_PROPOSAL: 'Proposals',
  PAYMENT_EXCEPTION: 'Money',
  CUSTODY: 'Custody',
};

export const areaOf = (type: CaseType): Area => AREA_BY_TYPE[type];

/** Case types that sit in an area, for the chip filters (the queue filters by type, not area). */
export const typesIn = (area: Area): CaseType[] =>
  (Object.keys(AREA_BY_TYPE) as CaseType[]).filter((type) => AREA_BY_TYPE[type] === area);

const TYPE_LABELS: Record<CaseType, string> = {
  DISPUTE: 'Dispute',
  KYB: 'Business check',
  MERCHANT_APPLICATION: 'Merchant application',
  IDENTITY: 'Identity check',
  FRAUD: 'Fraud signal',
  CUSTODY: 'Custody',
  PAYMENT_EXCEPTION: 'Payment exception',
  TRADE_PROPOSAL: 'Trade proposal',
  PARK_HUB_APPLICATION: 'Park hub application',
};
export const typeLabel = (type: CaseType): string => TYPE_LABELS[type];

const STATE_LABELS: Record<CaseState, string> = {
  OPEN: 'Open',
  INVESTIGATING: 'Investigating',
  AWAITING_EVIDENCE: 'Awaiting evidence',
  ESCALATED: 'Escalated',
  DECIDED: 'Decided',
  CLOSED: 'Closed',
};
export const stateLabel = (state: CaseState): string => STATE_LABELS[state];

const PRIORITY_LABELS: Record<CasePriority, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
};
export const priorityLabel = (priority: CasePriority): string => PRIORITY_LABELS[priority];

/** "52m", "1h 40m", "2d 20h": the most significant two units, nothing zero. */
export function clockLabel(sla: CaseView['sla']): string {
  if (sla.status === 'BREACHED') return 'Overdue';
  if (sla.status === 'STOPPED' || sla.remainingMinutes === null) return 'Stopped';
  const total = Math.max(0, sla.remainingMinutes);
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

export function clockTone(sla: CaseView['sla']): ChipTone | undefined {
  if (sla.status === 'BREACHED') return 'risk';
  if (sla.status === 'AT_RISK') return 'awaiting';
  return undefined;
}

/** Cases carry user ids only (no staff directory yet), so a colleague is a short id. */
export function ownerLabel(ownerUserId: string | null, viewerId: string | undefined): string {
  if (ownerUserId === null) return 'Unassigned';
  if (ownerUserId === viewerId) return 'You';
  return `Staff ${ownerUserId.slice(-12)}`;
}
