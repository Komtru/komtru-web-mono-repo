import { HOURS_AGO } from './kyc';
import { id } from './cases';

export const queueRow = (n: number, over: Record<string, unknown> = {}) => ({
  applicationId: id(600 + n),
  caseId: id(100 + n),
  caseNumber: `C-${String(2900 + n).padStart(6, '0')}`,
  caseState: 'OPEN',
  priority: 'NORMAL',
  slaStartedAt: HOURS_AGO(3),
  slaDueAt: '2099-11-11T10:00:00.000Z',
  ownerUserId: null,
  applicantUserId: id(300 + n),
  applicantPublicId: `KMT-U-AB12C${n}`,
  businessName: 'Techedge Nigeria Ltd',
  businessType: 'REGISTERED_BUSINESS',
  categories: ['PHONES'],
  status: 'SUBMITTED',
  submissionCount: 1,
  submittedAt: HOURS_AGO(3),
  ...over,
});

export const evidence = (over: Record<string, unknown> = {}) => ({
  identityLevel: 2,
  cacLookup: {
    state: 'VERIFIED',
    registeredBusinessName: 'TECHEDGE NIGERIA LIMITED',
    cacStatus: 'active',
    officersMatch: true,
    rcMatchesApplication: true,
  },
  documents: {
    required: ['CAC_CERTIFICATE', 'STATUS_REPORT_OR_MEMORANDUM', 'DIRECTOR_ID'],
    present: ['CAC_CERTIFICATE', 'STATUS_REPORT', 'DIRECTOR_ID'],
    missing: [],
    complete: true,
  },
  bankNameMatch: { state: 'EXACT', bankName: 'Access Bank', accountNumberMasked: '******5567' },
  ...over,
});

export const ADVISORY = {
  label: 'AI-suggested — not a decision',
  source: 'RULES_V1',
  suggestion: 'Review the checklist and decide',
  rationale: ['Every checklist item has been supplied'],
};

export const detail = (n: number, over: Record<string, unknown> = {}) => ({
  ...queueRow(n),
  form: {
    businessName: 'Techedge Nigeria Ltd',
    businessType: 'REGISTERED_BUSINESS',
    addressLine: '12 Allen Avenue',
    stateName: 'Lagos',
    cityName: 'Ikeja',
    categories: ['PHONES'],
    cacRcNumber: '123456',
  },
  documents: [
    { docType: 'CAC_CERTIFICATE', label: 'CAC certificate', contentType: 'application/pdf', viewable: true },
    { docType: 'STATUS_REPORT', label: 'CAC status report', contentType: 'application/pdf', viewable: false },
    { docType: 'DIRECTOR_ID', label: 'Proprietor or director ID', contentType: 'image/jpeg', viewable: true },
  ],
  evidence: evidence(),
  advisory: ADVISORY,
  applicant: {
    userId: id(300 + n),
    publicId: `KMT-U-AB12C${n}`,
    username: 'techedge',
    verificationLevel: 2,
    verificationLevelName: 'IDENTITY_VERIFIED',
    memberSince: '2026-01-02T00:00:00.000Z',
    trades: { total: 4, completed: 3 },
  },
  changesRequested: [],
  history: [
    {
      fromStatus: null,
      toStatus: 'DRAFT',
      actorType: 'APPLICANT',
      actorUserId: id(300 + n),
      reason: null,
      policyCitation: null,
      requested: [],
      createdAt: '2026-11-10T08:00:00.000Z',
    },
    {
      fromStatus: 'DRAFT',
      toStatus: 'SUBMITTED',
      actorType: 'APPLICANT',
      actorUserId: id(300 + n),
      reason: null,
      policyCitation: null,
      requested: [],
      createdAt: '2026-11-10T09:00:00.000Z',
    },
  ],
  ...over,
});

export const DECIDER = ['merchant.application.view', 'merchant.application.decide', 'cases.view'];
export const VIEWER = ['merchant.application.view'];

export const STANDARDS = {
  items: [
    {
      versionId: id(801),
      categoryCode: 'PHONES',
      categoryName: 'Phones',
      versionNumber: 1,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
    {
      versionId: id(802),
      categoryCode: 'LAPTOPS',
      categoryName: 'Laptops',
      versionNumber: 1,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  ],
  page: 1,
  limit: 100,
  total: 2,
};
