// Fixtures for the seller onboarding screens (T-121). Shaped as the platform sends them; `answerWith` parses each one
// against its endpoint's schema, so a fixture that drifts from the contract fails the suite.
import { id } from './trade';

export const SHOP_ID = id(301);
export const LAGOS_ID = id(302);
export const OGUN_ID = id(303);
export const IKEJA_ID = id(304);
export const PAYOUT_ACCOUNT_ID = id(305);
export const DOC = { cac: id(401), status: id(402), director: id(403) };

export const application = (over: Record<string, unknown> = {}) => ({
  id: SHOP_ID,
  status: 'DRAFT',
  form: {},
  documents: [],
  changesRequested: [],
  lastDecision: null,
  canEdit: true,
  submissionCount: 0,
  submittedAt: null,
  decidedAt: null,
  createdAt: '2026-11-14T10:00:00.000Z',
  ...over,
});

export const allDocuments = [
  { docType: 'CAC_CERTIFICATE', label: 'CAC certificate', fileId: DOC.cac },
  { docType: 'STATUS_REPORT', label: 'CAC status report', fileId: DOC.status },
  { docType: 'DIRECTOR_ID', label: 'Proprietor or director ID', fileId: DOC.director },
];

export const states = [
  { id: LAGOS_ID, code: 'LA', name: 'Lagos' },
  { id: OGUN_ID, code: 'OG', name: 'Ogun' },
];

export const verifiedOwner = {
  requirements: { identifier: true, liveness: true, business: false, businessBankAccount: false },
};

export const payoutAccount = (over: Record<string, unknown> = {}) => ({
  id: PAYOUT_ACCOUNT_ID,
  bankCode: '058',
  bankName: 'GTBank',
  accountNumberMasked: '******5567',
  accountName: 'TECHEDGE NIGERIA LTD',
  status: 'VERIFIED',
  isDefault: true,
  failureReason: null,
  createdAt: '2026-11-14T10:00:00.000Z',
  verifiedAt: '2026-11-14T10:01:00.000Z',
  ...over,
});
