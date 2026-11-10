import { id } from './cases';

export const HOURS_AGO = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();

export const queueItem = (n: number, over: Record<string, unknown> = {}) => ({
  caseId: id(100 + n),
  caseNumber: `C-${String(2800 + n).padStart(6, '0')}`,
  caseType: 'IDENTITY',
  state: 'OPEN',
  priority: 'NORMAL',
  slaDueAt: '2099-11-11T10:00:00.000Z',
  ownerUserId: null,
  requestId: id(200 + n),
  userId: id(300 + n),
  verificationType: 'BVN',
  submittedAt: HOURS_AGO(3),
  duplicateFlagId: null,
  duplicateFlagStatus: null,
  ...over,
});

export const paged = <T>(items: T[], total = items.length) => ({ items, page: 1, limit: 50, total });

export const flagRow = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(400 + n),
  identifierType: 'BVN',
  firstUserId: id(500 + n),
  conflictingUserId: id(300 + n),
  requestId: id(200 + n),
  status: 'OPEN',
  detectedAt: HOURS_AGO(5),
  reviewedBy: null,
  reviewedAt: null,
  resolutionNotes: null,
  ...over,
});

export const ADVISORY = {
  label: 'AI-suggested — not a decision',
  source: 'RULES_V1',
  suggestion: 'The provider matched the BVN. Suggest: approve.',
  rationale: ['Name matches the account'],
};

export const ANALYST = ['verification.view', 'verification.review', 'cases.view'];
export const VIEWER_ONLY = ['verification.view'];
