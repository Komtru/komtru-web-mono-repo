// How an identity review is written on screen. The queue carries a verification type and a user id,
// never a name or a provider's own words (T-050 keeps both out on purpose), so "who" and "provider
// result" are drawn from what exists.
import type { DuplicateFlagStatus } from '@komtru/api-client';
import type { ChipTone } from '@komtru/ui-kit';
import { humanise } from '../cases/format';

const TYPE_LABELS: Record<string, string> = {
  NIN: 'National ID number',
  BVN: 'Bank Verification Number',
  LIVENESS: 'Liveness check',
  CAC: 'Business registration (CAC)',
  BANK_ACCOUNT_NAME_MATCH: 'Bank account name',
  ADDRESS: 'Address proof',
  DOCUMENT: 'Document check',
  SOCIAL_PROOF: 'Social proof',
};

export const verificationLabel = (type: string): string => TYPE_LABELS[type] ?? humanise(type);

/** Business checks are the KYB cases; everything else is about a person. */
export const isBusiness = (caseType: string): boolean => caseType === 'KYB';

const HOUR_MS = 3_600_000;

export const waitingHours = (submittedAt: string, now: Date = new Date()): number =>
  Math.max(0, Math.floor((now.getTime() - new Date(submittedAt).getTime()) / HOUR_MS));

/** "3h", "1d": the largest whole unit, as the reference writes the Waiting column. */
export function waitingLabel(submittedAt: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(submittedAt).getTime()) / 60_000));
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}d`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h`;
  return `${minutes}m`;
}

/** The platform's day-one SLA lives on the case; a request waiting over a day is the reference's chip. */
export const OVER_A_DAY_HOURS = 24;

export function providerResult(item: { duplicateFlagStatus: string | null }): {
  label: string;
  tone: ChipTone;
} {
  if (item.duplicateFlagStatus === 'ESCALATED') {
    return { label: 'Duplicate identity, escalated', tone: 'risk' };
  }
  if (item.duplicateFlagStatus === 'OPEN') return { label: 'Duplicate identity', tone: 'risk' };
  return { label: 'Needs a person', tone: 'awaiting' };
}

/** Rows carry user ids only (no directory yet), so a person is the tail of their id. */
export const shortUser = (userId: string): string => `…${userId.slice(-6)}`;

const FLAG_LABELS: Record<DuplicateFlagStatus, string> = {
  OPEN: 'Open',
  CONFIRMED_DUPLICATE: 'Confirmed duplicate',
  CLEARED_FALSE_POSITIVE: 'Cleared as a false positive',
  ESCALATED: 'Escalated',
};
export const flagStatusLabel = (status: DuplicateFlagStatus): string => FLAG_LABELS[status];

export const FLAG_OPEN: readonly DuplicateFlagStatus[] = ['OPEN', 'ESCALATED'];

/** "Due in 3h", "Due in 1d 2h" or "Overdue": the case clock, from the one date the review queue carries. */
export function dueLabel(slaDueAt: string, now: Date = new Date()): { label: string; overdue: boolean } {
  const minutes = Math.floor((new Date(slaDueAt).getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return { label: 'Overdue', overdue: true };
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return { label: hours > 0 ? `Due in ${days}d ${hours}h` : `Due in ${days}d`, overdue: false };
  if (hours > 0)
    return { label: rest > 0 ? `Due in ${hours}h ${rest}m` : `Due in ${hours}h`, overdue: false };
  return { label: `Due in ${rest}m`, overdue: false };
}

/** A fact the owning module wrote, in the words an analyst would use. Anything unlisted is humanised. */
const FACT_LABELS: Record<string, string> = {
  verificationType: 'Kind of check',
  reason: 'Why it needs a person',
  attemptCount: 'Attempts so far',
  duplicateIdentity: 'Already verified on another account',
};
export const evidenceLabel = (key: string): string => FACT_LABELS[key] ?? humanise(key);
