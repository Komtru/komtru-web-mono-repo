// The vocabulary of the universal case index (T-107, M15's "index, not copy"). A case row points at
// the owning module's own record; these are the words every owning module and the console share.
export const CASE_TYPES = [
  'DISPUTE',
  'KYB',
  'MERCHANT_APPLICATION',
  'IDENTITY',
  'FRAUD',
  'CUSTODY',
  'PAYMENT_EXCEPTION',
  'TRADE_PROPOSAL',
  'PARK_HUB_APPLICATION',
] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const CASE_STATES = [
  'OPEN',
  'INVESTIGATING',
  'AWAITING_EVIDENCE',
  'ESCALATED',
  'DECIDED',
  'CLOSED',
] as const;
export type CaseState = (typeof CASE_STATES)[number];

export const CASE_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];

export const EVIDENCE_REQUEST_STATUSES = ['OPEN', 'FULFILLED', 'CANCELLED'] as const;
export type EvidenceRequestStatus = (typeof EVIDENCE_REQUEST_STATUSES)[number];

/** Every kind of row the trust trail can hold; a closed list so a query for one kind cannot miss. */
export const TRAIL_TYPES = [
  'REGISTERED',
  'TAKEN',
  'REASSIGNED',
  'PRIORITY_CHANGED',
  'ESCALATED',
  'EVIDENCE_REQUESTED',
  'EVIDENCE_RESOLVED',
  'FACTS_UPDATED',
  'DECISION_RECORDED',
  'CLOSED',
] as const;
export type TrailType = (typeof TRAIL_TYPES)[number];

/** A case in one of these is finished with as far as the work queue is concerned. */
export const FINISHED_STATES: readonly CaseState[] = ['DECIDED', 'CLOSED'];

/**
 * What the owning module tells the index about its record. Small, non-PII scalars only (ids, flags,
 * counts): the advisory reads these, and the index must never become a copy of the subject.
 */
export type CaseFacts = Record<string, string | number | boolean | null>;

export const MAX_FACT_KEYS = 30;

/** `C-002841`: how P0-01 and P0-02 print a case number. */
export const caseCode = (caseNumber: number): string => `C-${String(caseNumber).padStart(6, '0')}`;
